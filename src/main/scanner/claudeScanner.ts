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

/**
 * True when the session's transcript ends with an assistant tool_use that has
 * not yet been answered with a tool_result — i.e. Claude Code is waiting for
 * the user to approve a tool call or answer a question.
 */
export function isWaitingForApproval(projectsDir: string, session: ClaudeSessionInfo): boolean {
  if (!session.sessionId) return false;
  const file = findTranscript(projectsDir, session.sessionId);
  if (!file) return false;
  let tail: string;
  try {
    tail = readTail(file);
  } catch {
    return false;
  }
  const lines = tail.split('\n').filter((l) => l.trim().length > 0);
  if (!lines.length) return false;
  const last = lines[lines.length - 1];
  try {
    const o = JSON.parse(last);
    if (o?.type !== 'assistant') return false;
    const content = o?.message?.content;
    if (!Array.isArray(content)) return false;
    return content.some((b: unknown) => {
      const block = b as { type?: string } | null;
      return !!block && block.type === 'tool_use';
    });
  } catch {
    return false;
  }
}

export function deriveClaudeState(
  sessions: ClaudeSessionInfo[],
  claudePids: Set<number>,
  now: number,
  busyFreshnessMs: number,
  projectsDir: string
): { state: 'busy' | 'running' | 'idle' | 'unknown'; detail: string; session?: ClaudeSessionInfo } {
  const live = sessions.filter((s) => claudePids.has(s.pid));
  if (live.length === 0) {
    if (claudePids.size > 0) return { state: 'running', detail: 'running' };
    return { state: 'idle', detail: 'not running' };
  }
  const s = live[0];
  if (isWaitingForApproval(projectsDir, s)) {
    return { state: 'busy', detail: 'waiting for approval', session: s };
  }
  if (s.status === 'busy') return { state: 'busy', detail: 'working', session: s };
  if (s.status === 'idle') return { state: 'running', detail: 'idle', session: s };
  if (now - s.updatedAt < busyFreshnessMs) return { state: 'busy', detail: 'working', session: s };
  return { state: 'running', detail: 'active', session: s };
}
