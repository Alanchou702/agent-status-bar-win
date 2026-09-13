import type { AgentSnapshot, CodexActivity, CodexThreadInfo } from '../../shared/types.js';
import type { AppConfig } from '../config.js';
import { deriveCodexState, emptyActivity, queryCodexActivities, queryCodexThreads, type CodexThreadActivity } from './codexScanner.js';
import { readCodexRollout, type RolloutActivity } from './codexRollout.js';
import { resolveCodexDb } from './codexDbPath.js';

export function mergeActivity(logs?: CodexActivity, rollout?: CodexActivity): CodexActivity {
  const result = emptyActivity();
  for (const key of Object.keys(result) as (keyof CodexActivity)[]) result[key] = Math.max(logs?.[key] ?? 0, rollout?.[key] ?? 0);
  result.approvalResponse = Math.max(logs?.approvalResponse ?? 0, rollout?.approvalResponse ?? 0);
  return result;
}
export function codexSessionSnapshots(
  threads: CodexThreadInfo[], activities: CodexThreadActivity[], processPresent: boolean,
  now: number, config: Pick<AppConfig, 'codexTurnActivityFreshnessMs' | 'taskCompleteFreshnessMs'>,
  read: (file: string | undefined) => RolloutActivity | null = readCodexRollout,
  processStartedAt = 0
): AgentSnapshot[] {
  const logMap = new Map(activities.map(row => [row.threadId, row.activity]));
  const metadata = new Map(threads.map(thread => [thread.threadId, thread]));
  // Include threads already logging but not yet committed to the metadata DB.
  for (const row of activities) if (!metadata.has(row.threadId)) metadata.set(row.threadId,
    { threadId: row.threadId, title: '', cwd: '', updatedAt: row.activity.latest });
  const snapshots: AgentSnapshot[] = [];
  for (const thread of metadata.values()) {
    if (thread.archived) continue;
    const rollout = read(thread.rolloutPath);
    const logs = logMap.get(thread.threadId);
    const activity = mergeActivity(logs, rollout?.activity);
    const latest = activity.latest;
    const close = Math.max(activity.turnComplete, activity.taskClose, activity.interrupt);
    let state = deriveCodexState(activity, processPresent, now, config.codexTurnActivityFreshnessMs, config.taskCompleteFreshnessMs);
    if (processPresent && rollout) {
      const input = rollout.activity.userInputRequest;
      const approval = rollout.activity.approvalRequest;
      // Pending calls are correlated by ID; another tool cannot dismiss the wait.
      if (input > close) state = { state: 'busy', detail: 'waiting for your input' };
      if (approval > Math.max(close, activity.approvalResponse ?? 0)) state = { state: 'busy', detail: 'waiting for approval' };
      if (state.state !== 'busy' && !state.done && (rollout.openTurn || rollout.pendingTool || activity.taskStart > close) && rollout.activity.latest >= close) {
        state = { state: 'busy', detail: 'working' };
      }
    }
    // A global Codex process does not make every historical thread a live session.
    if (!state.done && state.state === 'running' && now - latest >= config.codexTurnActivityFreshnessMs) {
      state = { state: 'idle', detail: 'no recent activity' };
    }
    if (!logs && !rollout && processPresent && now - thread.updatedAt < config.codexTurnActivityFreshnessMs) {
      state = { state: 'unknown', detail: 'session log unavailable' };
    }
    if (processPresent && processStartedAt > 0 && latest < processStartedAt) {
      state = { state: 'idle', detail: 'previous process session' };
    }
    snapshots.push({ client: 'codex', ...state, codex: thread, activityAt: latest || thread.updatedAt, scannedAt: now });
  }
  return snapshots;
}
export function scanCodexSessions(config: AppConfig, processPresent: boolean, now: number, processStartedAt = 0): { snapshots: AgentSnapshot[]; warnings: string[] } {
  const activities = queryCodexActivities(resolveCodexDb(config.paths.codexLogsDb, 'logs'), config.codexThreadLookupWindowSec, now);
  const threads = queryCodexThreads(resolveCodexDb(config.paths.codexStateDb, 'state'));
  const warnings: string[] = [];
  if (processPresent && activities === null) warnings.push('Codex 活动数据库暂不可读，使用各会话记录继续监控。');
  if (processPresent && threads === null) warnings.push('Codex 会话目录暂不可读，当前仅显示日志中可发现的会话。');
  const snapshots = codexSessionSnapshots(threads ?? [], activities ?? [], processPresent, now, config, readCodexRollout, processStartedAt);
  if (!snapshots.length || (processPresent && !snapshots.some(s => s.state !== 'idle'))) {
    snapshots.push({ client: 'codex', state: !processPresent ? 'idle' : activities === null && threads === null ? 'unknown' : 'running',
      detail: !processPresent ? 'not running' : 'no active session', scannedAt: now });
  }
  return { snapshots, warnings };
}

