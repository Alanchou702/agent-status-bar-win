import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { configDir } from './config.js';
import { enumerateProcesses, isClaudeProcess, isCodexProcess } from './scanner/processEnumerator.js';

const POLL_MS = 2000;
const LOCK_FILE = path.join(configDir(), 'watch.lock');
const APP_LOCK = path.join(configDir(), 'app.lock');

function pidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireWatchLock(): boolean {
  try {
    const existing = Number(fs.readFileSync(LOCK_FILE, 'utf-8'));
    if (pidAlive(existing)) return false;
  } catch {
    /* no lock or stale */
  }
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(LOCK_FILE, String(process.pid));
    return true;
  } catch {
    return false;
  }
}

function releaseWatchLock(): void {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {
    /* ignore */
  }
}

function mainAppRunning(): boolean {
  try {
    const pid = Number(fs.readFileSync(APP_LOCK, 'utf-8'));
    return pidAlive(pid);
  } catch {
    return false;
  }
}

function launchMainApp(): void {
  const args = app.isPackaged ? [] : ['.'];
  const cwd = app.isPackaged ? path.dirname(process.execPath) : app.getAppPath();
  try {
    const child = spawn(process.execPath, args, { cwd, detached: true, stdio: 'ignore' });
    child.unref();
  } catch (e) {
    console.error('[watch] launch failed', e);
  }
}

/** Headless watcher: launches the main app the first time claude/codex starts running. */
export function startWatch(): void {
  if (!acquireWatchLock()) {
    app.quit();
    return;
  }
  app.on('will-quit', releaseWatchLock);

  let agentsWereRunning = false;
  const tick = async (): Promise<void> => {
    try {
      const procs = await enumerateProcesses();
      const agentsRunning = procs.some((p) => isClaudeProcess(p) || isCodexProcess(p));
      if (agentsRunning && !agentsWereRunning) {
        if (!mainAppRunning()) launchMainApp();
      }
      agentsWereRunning = agentsRunning;
    } catch {
      /* keep watching */
    }
  };

  void tick();
  setInterval(() => void tick(), POLL_MS);
}
