import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ClaudeSessionInfo } from '../../shared/types.js';

/** Read all session JSON files under ~/.claude/sessions, newest first. */
export function readClaudeSessions(sessionsDir: string): ClaudeSessionInfo[] {
  if (!fs.existsSync(sessionsDir)) return [];
  const out: ClaudeSessionInfo[] = [];
  for (const f of fs.readdirSync(sessionsDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf-8'));
      if (typeof j.pid !== 'number' || !j.sessionId) continue;
      out.push({
        pid: j.pid,
        sessionId: j.sessionId,
        cwd: typeof j.cwd === 'string' ? j.cwd : '',
        startedAt: typeof j.startedAt === 'number' ? j.startedAt : 0,
        updatedAt: typeof j.updatedAt === 'number' ? j.updatedAt : 0,
        version: j.version,
        kind: j.kind,
        status: j.status,
        title: j.title,
        name: j.name,
      });
    } catch {
      /* skip unparseable session files */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Locate a session's transcript JSONL under ~/.claude/projects/<project>/<sessionId>.jsonl. */
function findTranscript(projectsDir: string, sessionId: string): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = path.join(projectsDir, e.name, `${sessionId}.jsonl`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Read the tail of a file (bytes, default 64 KiB) without loading the whole thing. */
function readTail(file: string, bytes = 65536): string {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

export interface ClaudeTranscriptInfo {
  /** Last transcript line is an assistant message with an unanswered tool_use. */
  waitingApproval: boolean;
  /** Name of the most recent assistant tool_use (e.g. 'Delete'). */
  lastToolName: string | null;
  /** A turn_duration system event appeared within doneFreshnessMs of now. */
  justCompletedTurn: boolean;
  completedTurn: boolean;
  lastActivityAt: number;
}

/**
 * Read the transcript tail once and derive the flags the status light needs:
 * pending approval, the name of the last tool call (for the deleting state),
 * and whether the last turn just finished (for the task-complete marquee).
 */
export function analyzeClaudeTranscript(
  projectsDir: string,
  session: ClaudeSessionInfo,
  doneFreshnessMs: number,
  now: number
): ClaudeTranscriptInfo {
  const info: ClaudeTranscriptInfo = { waitingApproval: false, lastToolName: null, justCompletedTurn: false, completedTurn: false, lastActivityAt: 0 };
  if (!session.sessionId) return info;
  const file = findTranscript(projectsDir, session.sessionId);
  if (!file) return info;
  let tail: string;
  try {
    tail = readTail(file);
    info.lastActivityAt = fs.statSync(file).mtimeMs;
  } catch {
    return info;
  }
  const lines = tail.split('\n').filter((l) => l.trim().length > 0);
  if (!lines.length) return info;

  const resolved = new Set<string>();
  let sawCurrentActivity = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    let o: Record<string, any>;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    if (!o || typeof o !== 'object') continue;
    const content: Record<string, any>[] = Array.isArray(o.message?.content) ? o.message.content : [];
    if (o.type === 'system' && o.subtype === 'turn_duration') {
      const ts = Date.parse(String(o.timestamp ?? ''));
      info.completedTurn = !sawCurrentActivity;
      info.justCompletedTurn = !sawCurrentActivity && Number.isFinite(ts) && now >= ts && now - ts < doneFreshnessMs;
      break;
    }
    if (o.type === 'user') {
      const results = content.filter(b => b?.type === 'tool_result');
      if (!results.length) break;
      for (const block of results) if (typeof block.tool_use_id === 'string') resolved.add(block.tool_use_id);
      sawCurrentActivity = true;
    }
    if (o.type === 'assistant') {
      sawCurrentActivity = true;
      const pending = content.find(b => b?.type === 'tool_use' && typeof b.id === 'string' && !resolved.has(b.id));
      if (pending) {
        info.lastToolName = typeof pending.name === 'string' ? pending.name : null;
        // A pending tool can be executing or auto-approved; it is not evidence of a permission prompt.
        info.waitingApproval = /^(waiting_for_approval|permission_required)$/.test(session.status ?? '');
        break;
      }
    }
  }
  return info;
}

export function deriveClaudeState(
  sessions: ClaudeSessionInfo[],
  claudePids: Set<number>,
  now: number,
  busyFreshnessMs: number,
  projectsDir: string,
  doneFreshnessMs: number
): {
  state: 'busy' | 'running' | 'idle' | 'unknown';
  detail: string;
  session?: ClaudeSessionInfo;
  deleting?: boolean;
  done?: boolean;
} {
  const live = sessions.filter((s) => claudePids.has(s.pid));
  if (live.length === 0) {
    if (claudePids.size > 0) return { state: 'running', detail: 'running' };
    return { state: 'idle', detail: 'not running' };
  }
  const candidates = live.map(s => {
    const info = analyzeClaudeTranscript(projectsDir, s, doneFreshnessMs, now);
    const flags = { deleting: info.lastToolName === 'Delete', done: info.justCompletedTurn };
    if (info.waitingApproval || /^(waiting_for_approval|permission_required)$/.test(s.status ?? ''))
      return { state: 'busy' as const, detail: 'waiting for approval', session: s, ...flags, rank: 5 };
    if (info.lastToolName === 'AskUserQuestion')
      return { state: 'busy' as const, detail: 'waiting for your input', session: s, ...flags, rank: 4 };
    if (info.completedTurn) return { state: 'running' as const, detail: info.justCompletedTurn ? 'task complete' : 'idle', session: s, ...flags, rank: info.justCompletedTurn ? 2 : 1 };
    if (s.status === 'busy' || (s.status !== 'idle' && now - Math.max(s.updatedAt, info.lastActivityAt) < busyFreshnessMs))
      return { state: 'busy' as const, detail: 'working', session: s, ...flags, rank: 3 };
    return { state: 'running' as const, detail: 'idle', session: s, rank: 1 };
  });
  candidates.sort((a, b) => b.rank - a.rank || b.session.updatedAt - a.session.updatedAt);
  return candidates[0];
}
