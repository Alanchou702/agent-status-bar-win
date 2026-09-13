import * as fs from 'node:fs';
import { emptyActivity } from './codexScanner.js';
import type { CodexActivity } from '../../shared/types.js';

export interface RolloutActivity {
  activity: CodexActivity;
  openTurn: boolean;
  pendingTool: boolean;
}
/** Parse complete records only. A partial last line is retried on the next poll. */
export function parseCodexRollout(text: string): RolloutActivity {
  const activity = emptyActivity();
  const pending = new Map<string, { kind: 'input' | 'approval' | 'tool'; at: number; async: boolean }>();
  let openTurn = false;
  for (const line of text.split('\n')) {
    let record: Record<string, any>;
    try { record = JSON.parse(line); } catch { continue; }
    const payload = record?.payload;
    const at = Date.parse(record?.timestamp);
    if (!payload || !Number.isFinite(at)) continue;
    const type = payload.type;
    if (record.type === 'event_msg') {
      if (type === 'task_started') {
        activity.taskStart = at; activity.anyTurnActivity = at;
        openTurn = true; pending.clear();
      } else if (type === 'task_complete') {
        activity.turnComplete = at; activity.taskClose = at; openTurn = false; pending.clear();
      } else if (type === 'turn_aborted' || type === 'task_aborted') {
        activity.interrupt = at; activity.taskClose = at; openTurn = false; pending.clear();
      } else if (type === 'user_message') {
        activity.userInputResult = at; activity.anyTurnActivity = at;
        for (const [id, call] of pending) if (call.kind === 'input') pending.delete(id);
      } else if (['agent_message', 'agent_reasoning', 'item_started', 'item_completed', 'token_count'].includes(type)) {
        activity.anyTurnActivity = at;
      } else { continue; }
      activity.latest = Math.max(activity.latest, at);
    }
    if (record.type !== 'response_item') continue;
    if (type === 'function_call' || type === 'custom_tool_call') {
      activity.anyToolCall = at; activity.latest = Math.max(activity.latest, at);
      const name = String(payload.name ?? '').split('.').pop() ?? '';
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(payload.arguments ?? '{}'); } catch { /* Custom tools may use plain text. */ }
      const kind = /^(request_user_input(?:_async)?|ask_question|askquestion)$/.test(name) ? 'input' :
        args?.sandbox_permissions === 'require_escalated' ? 'approval' : 'tool';
      if (typeof payload.call_id === 'string') pending.set(payload.call_id, { kind, at, async: name === 'request_user_input_async' });
    } else if (type === 'function_call_output' || type === 'custom_tool_call_output') {
      activity.anyToolResult = at; activity.latest = Math.max(activity.latest, at);
      const call = pending.get(payload.call_id);
      // An async question acknowledgement is not the user's answer.
      let acknowledgement = false;
      try { acknowledgement = JSON.parse(payload.output)?.accepted === true; } catch { /* Normal text output. */ }
      if (!(call?.async && acknowledgement)) {
        if (call?.kind === 'input') activity.userInputResult = at;
        if (call?.kind === 'approval') activity.approvalResponse = at;
        pending.delete(payload.call_id);
      }
    } else if (type === 'message' || type === 'reasoning') {
      activity.anyTurnActivity = at; activity.latest = Math.max(activity.latest, at);
    }
  }
  // Preserve per-call waits even if an unrelated tool completed afterwards.
  for (const call of pending.values()) {
    if (call.kind === 'input') activity.userInputRequest = Math.max(activity.userInputRequest, call.at);
    if (call.kind === 'approval') activity.approvalRequest = Math.max(activity.approvalRequest, call.at);
  }
  return { activity, openTurn, pendingTool: pending.size > 0 };
}
export function readCodexRollout(file: string | undefined): RolloutActivity | null {
  if (!file) return null;
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    // Independent of task age: long silent waits remain discoverable after restart.
    const start = Math.max(0, size - 256 * 1024);
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return parseCodexRollout(buffer.toString('utf8'));
  } catch { return null; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

