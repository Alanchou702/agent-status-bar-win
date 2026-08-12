import type { AgentSnapshot, AgentSummary } from '../../shared/types.js';
import type { AppConfig } from '../config.js';
import { enumerateProcesses, isClaudeProcess, isCodexProcess } from './processEnumerator.js';
import { deriveClaudeState, readClaudeSessions } from './claudeScanner.js';
import { deriveCodexState, queryCodexActivity, queryCodexThread } from './codexScanner.js';
import { resolveCodexDb } from './codexDbPath.js';

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
    config.paths.claudeProjectsDir
  );
  const claudeSnap: AgentSnapshot = {
    client: 'claude',
    state: claudeState.state,
    detail: claudeState.detail,
    claude: claudeState.session,
    scannedAt: now,
  };

  const codex = queryCodexActivity(
    resolveCodexDb(config.paths.codexLogsDb, 'logs'),
    config.codexThreadLookupWindowSec
  );
  const codexState = deriveCodexState(
    codex?.activity ?? null,
    codexPids.size > 0,
    now,
    config.codexTurnActivityFreshnessMs
  );
  const codexThread = queryCodexThread(resolveCodexDb(config.paths.codexStateDb, 'state'));
  const codexSnap: AgentSnapshot = {
    client: 'codex',
    state: codexState.state,
    detail: codexState.detail,
    codex: codexThread ?? undefined,
    scannedAt: now,
  };

  const snapshots = [claudeSnap, codexSnap];
  return {
    summary: { snapshots, scannedAt: now },
    anyBusy: snapshots.some((s) => s.state === 'busy'),
    anyRunning: snapshots.some((s) => s.state === 'running'),
  };
}
