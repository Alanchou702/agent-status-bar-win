import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import type { CodexActivity, CodexThreadInfo } from '../../shared/types.js';

/**
 * Activity-state query ported from the macOS app. It inspects the most recent
 * codex thread in the lookup window and returns, per column, the latest
 * timestamp (ms) at which each kind of event happened.
 *
 * Note: node:sqlite returns rows as objects keyed by column name, so every
 * column carries an alias. Timestamps are computed in milliseconds inside
 * SQL (`ts * 1000 + ts_nanos / 1000000`) because the nanosecond form
 * (ts * 1e9 + ts_nanos ~ 1.7e18) overflows JavaScript's safe integer range.
 */
const ACTIVITY_SQL = `
WITH latest_thread AS (
  SELECT thread_id
  FROM logs
  WHERE ts >= strftime('%s','now') - ?
    AND thread_id IS NOT NULL
    AND thread_id != ''
  ORDER BY ts DESC, ts_nanos DESC, id DESC
  LIMIT 1
)
SELECT
  (SELECT thread_id FROM latest_thread) AS thread_id,
  COALESCE(MAX(ts * 1000 + ts_nanos / 1000000), 0) AS latest,
  COALESCE(MAX(CASE WHEN target = 'codex_core::tasks' AND feedback_log_body LIKE 'codex_core::tasks: new%' AND feedback_log_body LIKE '%turn{%' THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS task_start,
  COALESCE(MAX(CASE WHEN target = 'codex_core::tasks' AND feedback_log_body LIKE 'codex_core::tasks: close time.busy=%' AND feedback_log_body LIKE '%turn{%' THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS task_close,
  COALESCE(MAX(CASE WHEN target = 'codex_core::stream_events_utils' AND feedback_log_body LIKE '%:handle_output_item_done: ToolCall: exec_command {%' AND (feedback_log_body LIKE '%"sandbox_permissions":"require_escalated"%' OR feedback_log_body LIKE '%"sandbox_permissions": "require_escalated"%') THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS escalated_exec,
  COALESCE(MAX(CASE WHEN target IN ('codex_core::session', 'codex_core::tasks') AND (feedback_log_body LIKE 'session_loop%op.dispatch.exec_approval%' OR feedback_log_body LIKE 'session_loop%op.dispatch.patch_approval%') THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS approval_request,
  COALESCE(MAX(CASE WHEN target = 'codex_otel.trace_safe' AND feedback_log_body LIKE '%event.name="codex.tool_result"%' AND feedback_log_body LIKE '%tool_name=exec_command%' THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS exec_tool,
  COALESCE(MAX(CASE WHEN target = 'codex_core::stream_events_utils' AND (feedback_log_body LIKE '%:handle_output_item_done: ToolCall: request_user_input {%' OR feedback_log_body LIKE '%:handle_output_item_done: ToolCall: ask_question {%' OR feedback_log_body LIKE '%:handle_output_item_done: ToolCall: askquestion {%') THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS user_input_request,
  COALESCE(MAX(CASE WHEN target = 'codex_otel.trace_safe' AND feedback_log_body LIKE '%event.name="codex.tool_result"%' AND (feedback_log_body LIKE '%tool_name=request_user_input%' OR feedback_log_body LIKE '%tool_name=ask_question%' OR feedback_log_body LIKE '%tool_name=askquestion%') THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS user_input_result,
  COALESCE(MAX(CASE WHEN target = 'codex_core::session' AND feedback_log_body LIKE 'session_loop%interrupt received: abort current task%' THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS interrupt,
  COALESCE(MAX(CASE WHEN (target = 'codex_otel.trace_safe' AND (feedback_log_body LIKE '%otel.name="session_task.turn"%' OR feedback_log_body LIKE '%codex.op="user_input_with_turn_context"%' OR feedback_log_body LIKE '%run_sampling_request%' OR feedback_log_body LIKE '%event.name="codex.tool_result"%')) OR (target = 'codex_core::stream_events_utils' AND feedback_log_body LIKE '%:handle_output_item_done: ToolCall:%') THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS any_turn_activity,
  COALESCE(MAX(CASE WHEN target = 'codex_core::stream_events_utils' AND feedback_log_body LIKE '%:handle_output_item_done: ToolCall:%' THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS any_tool_call,
  COALESCE(MAX(CASE WHEN target = 'codex_otel.trace_safe' AND feedback_log_body LIKE '%event.name="codex.tool_result"%' THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS any_tool_result,
  COALESCE(MAX(CASE WHEN target = 'codex_core::session::turn' AND feedback_log_body LIKE '%:run_turn: post sampling token usage%' AND feedback_log_body LIKE '% needs_follow_up=true%' THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS turn_follow_up,
  COALESCE(MAX(CASE WHEN target = 'codex_core::session::turn' AND feedback_log_body LIKE '%:run_turn: post sampling token usage%' AND feedback_log_body LIKE '% needs_follow_up=false%' THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS turn_complete
FROM logs
WHERE thread_id = (SELECT thread_id FROM latest_thread);
`;

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

/** Query the codex activity state machine. Returns null when the DB is missing/unreadable. */
export function queryCodexActivity(
  logsDbPath: string,
  lookupWindowSec: number
): { threadId: string | null; activity: CodexActivity } | null {
  if (!fs.existsSync(logsDbPath)) return null;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(logsDbPath, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 3000');
    const row = db
      .prepare(ACTIVITY_SQL)
      .get(lookupWindowSec) as Record<string, number | string | null> | undefined;
    if (!row) {
      return { threadId: null, activity: emptyActivity() };
    }
    return {
      threadId: typeof row.thread_id === 'string' ? row.thread_id : null,
      activity: {
        latest: num(row.latest),
        taskStart: num(row.task_start),
        taskClose: num(row.task_close),
        escalatedExec: num(row.escalated_exec),
        approvalRequest: num(row.approval_request),
        execTool: num(row.exec_tool),
        userInputRequest: num(row.user_input_request),
        userInputResult: num(row.user_input_result),
        interrupt: num(row.interrupt),
        anyTurnActivity: num(row.any_turn_activity),
        anyToolCall: num(row.any_tool_call),
        anyToolResult: num(row.any_tool_result),
        turnFollowUp: num(row.turn_follow_up),
        turnComplete: num(row.turn_complete),
      },
    };
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

function emptyActivity(): CodexActivity {
  return {
    latest: 0,
    taskStart: 0,
    taskClose: 0,
    escalatedExec: 0,
    approvalRequest: 0,
    execTool: 0,
    userInputRequest: 0,
    userInputResult: 0,
    interrupt: 0,
    anyTurnActivity: 0,
    anyToolCall: 0,
    anyToolResult: 0,
    turnFollowUp: 0,
    turnComplete: 0,
  };
}

/** Read the most recent thread's title/cwd from the state DB. */
export function queryCodexThread(stateDbPath: string): CodexThreadInfo | null {
  if (!fs.existsSync(stateDbPath)) return null;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(stateDbPath, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 3000');
    const row = db
      .prepare(
        "SELECT id, COALESCE(title, '') AS title, COALESCE(cwd, '') AS cwd, COALESCE(updated_at, 0) AS updated_at FROM threads ORDER BY updated_at DESC LIMIT 1"
      )
      .get() as { id: string; title: string; cwd: string; updated_at: number } | undefined;
    if (!row) return null;
    return {
      threadId: row.id,
      title: row.title,
      cwd: row.cwd,
      updatedAt: row.updated_at * 1000,
    };
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

/** Derive an AgentState-ish summary for codex from raw activity + process presence. */
export function deriveCodexState(
  activity: CodexActivity | null,
  processPresent: boolean,
  now: number,
  activityFreshnessMs: number
): { state: 'busy' | 'running' | 'idle' | 'unknown'; detail: string } {
  if (activity === null) {
    return processPresent
      ? { state: 'running', detail: 'logs unavailable' }
      : { state: 'unknown', detail: 'db unreadable' };
  }
  const last = maxTs(activity);
  if (last === 0) {
    return processPresent
      ? { state: 'running', detail: 'idle' }
      : { state: 'idle', detail: 'not running' };
  }
  if (!processPresent) {
    return now - last < activityFreshnessMs
      ? { state: 'running', detail: 'finished recently' }
      : { state: 'idle', detail: 'not running' };
  }
  if (now - activity.latest >= activityFreshnessMs) {
    return { state: 'running', detail: 'idle' };
  }
  // Process present and the active thread recently logged — decide busy sub-states.
  if (activity.approvalRequest >= activity.turnComplete && now - activity.approvalRequest < activityFreshnessMs) {
    return { state: 'busy', detail: 'waiting for approval' };
  }
  if (activity.userInputRequest >= activity.anyToolResult && now - activity.userInputRequest < activityFreshnessMs) {
    return { state: 'busy', detail: 'waiting for your input' };
  }
  if (activity.taskStart > activity.taskClose) {
    return { state: 'busy', detail: 'working' };
  }
  if (activity.turnFollowUp > activity.turnComplete && now - activity.turnFollowUp < activityFreshnessMs) {
    return { state: 'busy', detail: 'working' };
  }
  if (activity.anyToolResult > activity.turnComplete && now - activity.anyToolResult < activityFreshnessMs) {
    return { state: 'busy', detail: 'working' };
  }
  return { state: 'running', detail: 'active' };
}

function maxTs(a: CodexActivity): number {
  return Math.max(
    a.latest,
    a.taskStart,
    a.taskClose,
    a.escalatedExec,
    a.approvalRequest,
    a.execTool,
    a.userInputRequest,
    a.userInputResult,
    a.interrupt,
    a.anyTurnActivity,
    a.anyToolCall,
    a.anyToolResult,
    a.turnFollowUp,
    a.turnComplete
  );
}
