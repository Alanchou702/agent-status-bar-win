import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProcInfo } from '../../shared/types.js';

const execFileAsync = promisify(execFile);

const PS_SCRIPT = `
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
Get-CimInstance Win32_Process -Filter "Name = 'claude.exe' OR Name = 'codex.exe' OR Name = 'node.exe'" |
  Select-Object ProcessId, ParentProcessId, Name, CommandLine, @{Name='StartedAtMs';Expression={([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()}} |
  ConvertTo-Json -Compress
`;

interface PsRow {
  ProcessId: number;
  ParentProcessId: number;
  Name: string | null;
  CommandLine: string | null;
  StartedAtMs?: number;
}

export async function enumerateProcesses(timeoutMs = 15_000): Promise<ProcInfo[]> {
  // The production scanner targets Windows; returning no processes elsewhere
  // keeps the CLI and build checks usable on macOS/Linux development machines.
  if (process.platform !== 'win32') return [];

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
    throw new Error('进程列表无法解析，请刷新重试。');
  }
  const out: ProcInfo[] = [];
  for (const r of rows) {
    if (!r || typeof r.ProcessId !== 'number') continue;
    out.push({
      pid: r.ProcessId,
      ppid: r.ParentProcessId ?? 0,
      name: r.Name ?? '',
      cmd: r.CommandLine ?? '',
      startedAt: r.StartedAtMs,
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
