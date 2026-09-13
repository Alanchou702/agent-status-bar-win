import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { DisplayState } from '../shared/status.js';

const files: Partial<Record<DisplayState, string>> = {
  approval: 'alert-approval.wav',
  input: 'alert-input.wav',
  done: 'alert-done.wav',
  unknown: 'alert-unknown.wav',
};

let lastPlayed = 0;

/** Play a bundled WAV asynchronously through the Windows system audio service. */
export function playStatusSound(resources: string, state: DisplayState): void {
  const name = files[state];
  if (!name || Date.now() - lastPlayed < 1_000) return;
  const file = path.join(resources, name);
  if (!existsSync(file)) return;
  lastPlayed = Date.now();
  const command = `$player = New-Object System.Media.SoundPlayer '${file.replace(/'/g, "''")}'; $player.PlaySync()`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}
