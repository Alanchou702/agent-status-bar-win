import type { AgentSnapshot, AgentSummary } from '../../shared/types.js';
import type { AppConfig } from '../config.js';
import { enumerateProcesses, isClaudeProcess, isCodexProcess } from './processEnumerator.js';
import { deriveClaudeState, readClaudeSessions } from './claudeScanner.js';
import { scanCodexSessions } from './codexSessions.js';

export interface ScanResult {
  summary: AgentSummary;
  anyBusy: boolean;
  anyRunning: boolean;
}

/** One full scan of both agents. Throws on process enumeration failure. */
export async function scanAll(config: AppConfig): Promise<ScanResult> {
  const now = Date.now();
  const procs = await enumerateProcesses();
  const claudePids = new Set(procs.filter(isClaudeProcess).map((p) => p.pid));
  const codexPids = new Set(procs.filter(isCodexProcess).map((p) => p.pid));

  const claudeSessions = readClaudeSessions(config.paths.claudeSessionsDir);
  const claudeState = deriveClaudeState(
    claudeSessions,
    claudePids,
    now,
    config.claudeBusyFreshnessMs,
    config.paths.claudeProjectsDir,
    config.taskCompleteFreshnessMs
  );
  const claudeSnap: AgentSnapshot = {
    client: 'claude',
    state: claudeState.state,
    detail: claudeState.detail,
    deleting: claudeState.deleting,
    done: claudeState.done,
    claude: claudeState.session,
    scannedAt: now,
  };

  const starts = procs.filter(isCodexProcess).map(p => p.startedAt ?? 0).filter(t => t > 0);
  const codex = scanCodexSessions(config, codexPids.size > 0, now, starts.length ? Math.min(...starts) : 0);
  const snapshots = [claudeSnap, ...codex.snapshots];
  return {
    summary: { snapshots, scannedAt: now, warnings: codex.warnings },
    anyBusy: snapshots.some((s) => s.state === 'busy'),
    anyRunning: snapshots.some((s) => s.state === 'running'),
  };
}
