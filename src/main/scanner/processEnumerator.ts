import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProcInfo } from '../../shared/types.js';

const execFileAsync = promisify(execFile);

const PS_SCRIPT = `
Get-CimInstance Win32_Process |
  Select-Object ProcessId, ParentProcessId, Name, CommandLine |
  ConvertTo-Json -Compress
`;

interface PsRow {
  ProcessId: number;
  ParentProcessId: number;
  Name: string | null;
  CommandLine: string | null;
}

export async function enumerateProcesses(timeoutMs = 15_000): Promise<ProcInfo[]> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT],
    { windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }
  );
  return parsePsOutput(stdout);
}

export function parsePsOutput(stdout: string): ProcInfo[] {
  if (!stdout.trim()) return [];
  let rows: PsRow[];
  try {
    const parsed = JSON.parse(stdout);
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
  const out: ProcInfo[] = [];
  for (const r of rows) {
    if (!r || typeof r.ProcessId !== 'number') continue;
    out.push({
      pid: r.ProcessId,
      ppid: r.ParentProcessId ?? 0,
      name: r.Name ?? '',
      cmd: r.CommandLine ?? '',
    });
  }
  return out;
}

export function isClaudeProcess(p: ProcInfo): boolean {
  if (p.pid === process.pid) return false;
  const name = p.name.toLowerCase();
  const cmd = p.cmd.toLowerCase();
  if (name === 'claude.exe') return true;
  // npm-installed Claude Code runs node with the @anthropic-ai/claude-code cli.js path.
  return name.includes('node') && (cmd.includes('claude-code') || cmd.includes('\\claude\\cli.js'));
}

export function isCodexProcess(p: ProcInfo): boolean {
  if (p.pid === process.pid) return false;
  const name = p.name.toLowerCase();
  const cmd = p.cmd.toLowerCase();
  if (name === 'codex.exe') return true;
  return name.includes('node') && /(?:^|[\\/ ])codex(?:\.js|\.cmd|$)/i.test(cmd);
}
