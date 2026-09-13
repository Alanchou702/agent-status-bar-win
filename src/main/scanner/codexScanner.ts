import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import type { CodexActivity, CodexThreadInfo } from '../../shared/types.js';

/**
 * Batch activity query for all Codex threads. It returns, per column, the latest
 * timestamp (ms) at which each kind of event happened.
 *
 * Note: node:sqlite returns rows as objects keyed by column name, so every
 * column carries an alias. Timestamps are computed in milliseconds inside
 * SQL (`ts * 1000 + ts_nanos / 1000000`) because the nanosecond form
 * (ts * 1e9 + ts_nanos ~ 1.7e18) overflows JavaScript's safe integer range.
 */
const ACTIVITY_SQL = `
SELECT
  thread_id,
  COALESCE(MAX(ts * 1000 + ts_nanos / 1000000), 0) AS latest,
  COALESCE(MAX(CASE WHEN target = 'codex_core::tasks' AND feedback_log_body LIKE 'codex_core::tasks: new%' AND feedback_log_body LIKE '%turn{%' THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS task_start,
  COALESCE(MAX(CASE WHEN target = 'codex_core::tasks' AND feedback_log_body LIKE 'codex_core::tasks: close time.busy=%' AND feedback_log_body LIKE '%turn{%' THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS task_close,
  COALESCE(MAX(CASE WHEN target = 'codex_core::stream_events_utils' AND feedback_log_body LIKE '%:handle_output_item_done: ToolCall: exec_command {%' AND (feedback_log_body LIKE '%"sandbox_permissions":"require_escalated"%' OR feedback_log_body LIKE '%"sandbox_permissions": "require_escalated"%') THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS escalated_exec,
  COALESCE(MAX(CASE WHEN target IN ('codex_core::session', 'codex_core::tasks') AND (feedback_log_body LIKE '%waiting for approval%' OR feedback_log_body LIKE '%approval requested%' OR feedback_log_body LIKE '%requesting%approval%') THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS approval_request,
  COALESCE(MAX(CASE WHEN target IN ('codex_core::session', 'codex_core::tasks') AND (feedback_log_body LIKE 'session_loop%op.dispatch.exec_approval%' OR feedback_log_body LIKE 'session_loop%op.dispatch.patch_approval%') THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS approval_response,
  COALESCE(MAX(CASE WHEN target = 'codex_otel.trace_safe' AND feedback_log_body LIKE '%event.name="codex.tool_result"%' AND feedback_log_body LIKE '%tool_name=exec_command%' THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS exec_tool,
  COALESCE(MAX(CASE WHEN target = 'codex_core::stream_events_utils' AND (feedback_log_body LIKE '%:handle_output_item_done: ToolCall: request_user_input {%' OR feedback_log_body LIKE '%:handle_output_item_done: ToolCall: request_user_input_async {%' OR feedback_log_body LIKE '%:handle_output_item_done: ToolCall: ask_question {%' OR feedback_log_body LIKE '%:handle_output_item_done: ToolCall: askquestion {%') THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS user_input_request,
  COALESCE(MAX(CASE WHEN target = 'codex_otel.trace_safe' AND feedback_log_body LIKE '%event.name="codex.tool_result"%' AND (feedback_log_body LIKE '%tool_name=request_user_input%' OR feedback_log_body LIKE '%tool_name=ask_question%' OR feedback_log_body LIKE '%tool_name=askquestion%') THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS user_input_result,
  COALESCE(MAX(CASE WHEN target = 'codex_core::session' AND feedback_log_body LIKE 'session_loop%interrupt received: abort current task%' THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS interrupt,
  COALESCE(MAX(CASE WHEN (target = 'codex_otel.trace_safe' AND (feedback_log_body LIKE '%otel.name="session_task.turn"%' OR feedback_log_body LIKE '%codex.op="user_input_with_turn_context"%' OR feedback_log_body LIKE '%run_sampling_request%' OR feedback_log_body LIKE '%event.name="codex.tool_result"%')) OR (target = 'codex_core::stream_events_utils' AND feedback_log_body LIKE '%:handle_output_item_done: ToolCall:%') THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS any_turn_activity,
  COALESCE(MAX(CASE WHEN target = 'codex_core::stream_events_utils' AND feedback_log_body LIKE '%:handle_output_item_done: ToolCall:%' THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS any_tool_call,
  COALESCE(MAX(CASE WHEN target = 'codex_otel.trace_safe' AND feedback_log_body LIKE '%event.name="codex.tool_result"%' THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS any_tool_result,
  COALESCE(MAX(CASE WHEN target = 'codex_core::session::turn' AND feedback_log_body LIKE '%:run_turn: post sampling token usage%' AND feedback_log_body LIKE '% needs_follow_up=true%' THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS turn_follow_up,
  COALESCE(MAX(CASE WHEN target = 'codex_core::session::turn' AND feedback_log_body LIKE '%:run_turn: post sampling token usage%' AND feedback_log_body LIKE '% needs_follow_up=false%' THEN ts * 1000 + ts_nanos / 1000000 END), 0) AS turn_complete
FROM logs
WHERE thread_id IS NOT NULL AND thread_id != ''
  AND ts >= ?
GROUP BY thread_id
ORDER BY latest DESC, thread_id ASC;
`;

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

/** Read every thread in one indexed time-range query; never discard quieter threads. */
export function queryCodexActivities(
  logsDbPath: string,
  lookupWindowSec: number,
  now = Date.now()
): CodexThreadActivity[] | null {
  if (!fs.existsSync(logsDbPath)) return null;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(logsDbPath, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 3000');
    const rows = db
      .prepare(ACTIVITY_SQL)
      .all(Math.floor(now / 1000) - lookupWindowSec) as Record<string, number | string | null>[];
    return rows.map(row => ({
      threadId: String(row.thread_id),
      activity: {
        latest: num(row.latest),
        taskStart: num(row.task_start),
        taskClose: num(row.task_close),
        escalatedExec: num(row.escalated_exec),
        approvalRequest: num(row.approval_request),
        approvalResponse: num(row.approval_response),
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
    }));
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

export function emptyActivity(): CodexActivity {
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

export interface CodexThreadActivity { threadId: string; activity: CodexActivity }

/** Compatibility for the one-shot API; production uses the complete array. */
export function queryCodexActivity(logsDbPath: string, lookupWindowSec: number): { threadId: string | null; activity: CodexActivity } | null {
  const rows = queryCodexActivities(logsDbPath, lookupWindowSec);
  return rows === null ? null : rows[0] ?? { threadId: null, activity: emptyActivity() };
}

/** Metadata query has no recent-thread limit. Optional columns support older state DBs. */
export function queryCodexThreads(stateDbPath: string): CodexThreadInfo[] | null {
  if (!fs.existsSync(stateDbPath)) return null;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(stateDbPath, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 3000');
    const columns = new Set((db.prepare('PRAGMA table_info(threads)').all() as { name: string }[]).map(row => row.name));
    const optional = (name: string, fallback: string) => columns.has(name) ? `COALESCE(${name}, ${fallback}) AS ${name}` : `${fallback} AS ${name}`;
    const fields = ['rollout_path', 'source', 'agent_nickname'].map(name => optional(name, "''"));
    fields.push(optional('archived', '0'));
    const rows = db.prepare(`SELECT id, COALESCE(title, '') AS title, COALESCE(cwd, '') AS cwd,
      COALESCE(updated_at, 0) AS updated_at, ${fields.join(', ')} FROM threads ORDER BY updated_at DESC, id ASC`).all() as Record<string, unknown>[];
    return rows.map(row => ({ threadId: String(row.id), title: String(row.title), cwd: String(row.cwd),
      updatedAt: num(row.updated_at) * 1000, rolloutPath: String(row.rollout_path), archived: !!row.archived,
      source: String(row.source), nickname: String(row.agent_nickname) }));
  } catch { return null; }
  finally { try { db?.close(); } catch { /* already closed */ } }
}

export function queryCodexThread(stateDbPath: string, threadId?: string | null): CodexThreadInfo | null {
  const rows = queryCodexThreads(stateDbPath);
  return (threadId ? rows?.find(row => row.threadId === threadId) : rows?.[0]) ?? null;
}

/** Derive an AgentState-ish summary for codex from raw activity + process presence. */
export function deriveCodexState(
  activity: CodexActivity | null,
  processPresent: boolean,
  now: number,
  activityFreshnessMs: number,
  doneFreshnessMs: number
): {
  state: 'busy' | 'running' | 'idle' | 'unknown';
  detail: string;
  deleting?: boolean;
  done?: boolean;
} {
  if (activity === null) {
    return processPresent
      ? { state: 'unknown', detail: 'logs unavailable' }
      : { state: 'idle', detail: 'not running' };
  }
  const last = maxTs(activity);
  const closed = Math.max(activity.turnComplete, activity.taskClose, activity.interrupt);
  if (last === 0) {
    return processPresent
      ? { state: 'running', detail: 'idle' }
      : { state: 'idle', detail: 'not running' };
  }
  // A turn that just completed is shown as the task-complete marquee, even if
  // the process is gone or the session still looks recent.
  if (
    activity.turnComplete > 0 &&
    now - activity.turnComplete < doneFreshnessMs &&
    activity.turnComplete >= Math.max(activity.taskStart, activity.turnFollowUp, activity.anyToolResult, activity.anyToolCall, activity.interrupt)
  ) {
    return { state: 'running', detail: 'task complete', done: true };
  }
  if (!processPresent) {
    return { state: 'idle', detail: 'not running' };
  }
  // Process present and the active thread recently logged — decide busy sub-states.
  const approval = Math.max(activity.approvalRequest, activity.escalatedExec);
  if (approval > Math.max(closed, activity.approvalResponse ?? 0, activity.execTool, activity.anyToolResult)) {
    return { state: 'busy', detail: 'waiting for approval' };
  }
  if (activity.userInputRequest > Math.max(closed, activity.userInputResult, activity.anyToolResult)) {
    return { state: 'busy', detail: 'waiting for your input' };
  }
  if (now - last >= activityFreshnessMs) return { state: 'running', detail: 'idle' };
  if (activity.taskStart > closed) {
    return { state: 'busy', detail: 'working' };
  }
  if (activity.turnFollowUp > closed && now - activity.turnFollowUp < activityFreshnessMs) {
    return { state: 'busy', detail: 'working' };
  }
  if (Math.max(activity.anyToolResult, activity.anyToolCall, activity.anyTurnActivity) > closed) {
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
    a.approvalResponse ?? 0,
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
