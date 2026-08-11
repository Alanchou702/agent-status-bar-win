import { Menu, Tray, nativeImage } from 'electron';
import * as path from 'node:path';
import type { AgentSnapshot, AgentSummary, AgentState } from '../shared/types.js';

export type SimulatedState = 'idle' | 'running' | 'busy' | 'approval';

export interface TrayHandlers {
  onRefresh: () => void;
  onToggleStartAtLogin: () => void;
  onToggleDesktopLight: () => void;
  onSimulate: (state: SimulatedState) => void;
  onQuit: () => void;
}

let tray: Tray | null = null;
let blinkTimer: ReturnType<typeof setInterval> | null = null;
let blinking = false;

function stateLabel(state: AgentState, detail?: string): string {
  const main = state === 'busy' ? 'Busy' : state === 'running' ? 'Running' : state === 'idle' ? 'Idle' : 'Unknown';
  return detail ? `${main} — ${detail}` : main;
}

function dot(state: AgentState): string {
  return state === 'busy' || state === 'running' ? '●' : '○';
}

const isApproval = (s: AgentSnapshot): boolean =>
  s.state === 'busy' && !!s.detail && /approval|permission/i.test(s.detail);

function pickIconFile(summary: AgentSummary): string {
  const anyApproval = summary.snapshots.some(isApproval);
  const anyBusy = summary.snapshots.some((s) => s.state === 'busy');
  const anyRunning = summary.snapshots.some((s) => s.state === 'running');
  if (anyApproval) return 'tray-approval.ico';
  if (anyBusy) return 'tray-busy.ico';
  if (anyRunning) return 'tray-running.ico';
  return 'tray-idle.ico';
}

function buildTemplate(
  summary: AgentSummary,
  startAtLogin: boolean,
  lightEnabled: boolean,
  handlers: TrayHandlers
): Electron.MenuItemConstructorOptions[] {
  const items: Electron.MenuItemConstructorOptions[] = [];

  items.push({ label: 'Agents', enabled: false });

  for (const snap of summary.snapshots) {
    const label = snap.client === 'claude' ? 'Claude Code' : 'Codex';
    items.push({ label: `${dot(snap.state)} ${label} — ${stateLabel(snap.state, snap.detail)}`, enabled: false });

    const sessionLine = snap.client === 'claude' ? snap.claude : snap.codex;
    if (sessionLine) {
      const title = snap.client === 'claude' ? snap.claude?.name ?? snap.claude?.title : snap.codex?.title;
      const cwd = snap.client === 'claude' ? snap.claude?.cwd : snap.codex?.cwd;
      const parts = [title ? `Session: ${title}` : 'Session: —', cwd ? `[${cwd}]` : ''].filter(Boolean);
      if (parts.length) items.push({ label: `  ${parts.join(' ')}`, enabled: false });
    }

    if (snap.credits?.available) {
      const weekly = snap.credits.weeklyRemainingPercent;
      const line = weekly !== undefined ? `  Weekly credits: ${weekly}%` : '  Credits: N/A';
      items.push({ label: line, enabled: false });
    }
  }

  items.push({ type: 'separator' });
  items.push({ label: 'Refresh', click: () => handlers.onRefresh() });
  items.push({ type: 'separator' });
  items.push({
    label: 'Start with agents at login',
    type: 'checkbox',
    checked: startAtLogin,
    click: () => handlers.onToggleStartAtLogin(),
  });
  items.push({
    label: 'Show desktop light',
    type: 'checkbox',
    checked: lightEnabled,
    click: () => handlers.onToggleDesktopLight(),
  });
  items.push({
    label: 'Simulate state',
    submenu: [
      { label: 'Idle (gray)', click: () => handlers.onSimulate('idle') },
      { label: 'Running (blue)', click: () => handlers.onSimulate('running') },
      { label: 'Busy (green, blinking)', click: () => handlers.onSimulate('busy') },
      { label: 'Waiting approval (red, blinking)', click: () => handlers.onSimulate('approval') },
    ],
  });
  items.push({ type: 'separator' });
  items.push({ label: 'Quit', click: () => handlers.onQuit() });

  return items;
}

export function createTray(
  resourcesDir: string,
  handlers: TrayHandlers,
  startAtLogin: boolean,
  lightEnabled: boolean
): Tray {
  const empty: AgentSummary = { snapshots: [], scannedAt: Date.now() };
  tray = new Tray(nativeImage.createFromPath(path.join(resourcesDir, 'tray-idle.ico')));
  tray.setToolTip('AgentStatusBar');
  tray.setContextMenu(Menu.buildFromTemplate(buildTemplate(empty, startAtLogin, lightEnabled, handlers)));
  return tray;
}

export function updateTray(
  resourcesDir: string,
  summary: AgentSummary,
  startAtLogin: boolean,
  lightEnabled: boolean,
  handlers: TrayHandlers
): void {
  if (!tray) return;
  if (!blinking) {
    tray.setImage(nativeImage.createFromPath(path.join(resourcesDir, pickIconFile(summary))));
  }
  tray.setToolTip(
    summary.snapshots
      .map((s) => `${s.client === 'claude' ? 'Claude' : 'Codex'}: ${s.state}`)
      .join('  ·  ') || 'AgentStatusBar'
  );
  tray.setContextMenu(Menu.buildFromTemplate(buildTemplate(summary, startAtLogin, lightEnabled, handlers)));
}

/** Blink the tray icon (given icon alternating with transparent) while it's active. Pass null to stop. */
export function setTrayBlink(resourcesDir: string, blinkIcon: string | null): void {
  blinking = blinkIcon !== null;
  if (blinkIcon && !blinkTimer) {
    let visible = true;
    blinkTimer = setInterval(() => {
      if (!tray) return;
      visible = !visible;
      tray.setImage(
        visible
          ? nativeImage.createFromPath(path.join(resourcesDir, blinkIcon))
          : nativeImage.createEmpty()
      );
    }, 500);
  } else if (!blinkIcon && blinkTimer) {
    clearInterval(blinkTimer);
    blinkTimer = null;
    if (tray) {
      tray.setImage(nativeImage.createFromPath(path.join(resourcesDir, 'tray-idle.ico')));
    }
  }
}
