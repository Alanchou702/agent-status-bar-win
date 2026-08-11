import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentClient, AgentSnapshot, AgentState, AgentSummary, CreditSnapshot } from '../shared/types.js';
import { configDir, loadConfig, saveConfig } from './config.js';
import {
  createLightWindow,
  defaultLightPosition,
  destroyLight,
  isLightVisible,
  updateLight,
} from './desktopLight.js';
import { setKeepAwake } from './keepAwake.js';
import { notify, type NotificationKind } from './notifications.js';
import { scanClaudeCredits } from './scanner/creditScanner.js';
import { scanAll } from './scanner/scanAll.js';
import { statusFor } from './statusLight.js';
import { createTray, setTrayBlink, updateTray, type SimulatedState, type TrayHandlers } from './tray.js';
import { startWatch } from './watch.js';

const CLIENT_NAME: Record<AgentClient, string> = { claude: 'Claude Code', codex: 'Codex' };

let summary: AgentSummary = { snapshots: [], scannedAt: 0 };
let prevKind = new Map<AgentClient, NotificationKind | null>();
let lastClaudeCredits: CreditSnapshot | undefined;
let lastCreditScanAt = 0;
let resourcesDir = '';
let startAtLogin = false;
let lightEnabled = false;
let simulated: AgentSummary | null = null;
let simulateTimer: ReturnType<typeof setTimeout> | null = null;

/** Push the current summary into the light + tray visuals. */
function applyVisuals(s: AgentSummary): void {
  const light = statusFor(s);
  updateLight({ color: light.color, blink: light.blink });
  setTrayBlink(resourcesDir, light.blinkIcon);
  updateTray(resourcesDir, s, startAtLogin, lightEnabled, trayHandlers);
}

function buildSimulatedSummary(state: SimulatedState): AgentSummary {
  const now = Date.now();
  const snap = (client: AgentClient, st: AgentState, detail?: string): AgentSnapshot => ({
    client,
    state: st,
    detail,
    scannedAt: now,
    claude:
      client === 'claude'
        ? { pid: 0, sessionId: 'sim', cwd: '', startedAt: now, updatedAt: now, status: st }
        : undefined,
    codex: client === 'codex' ? { threadId: 'sim', title: 'Simulation', cwd: '', updatedAt: now } : undefined,
  });
  switch (state) {
    case 'running':
      return { snapshots: [snap('claude', 'running', 'running'), snap('codex', 'running', 'running')], scannedAt: now };
    case 'busy':
      return { snapshots: [snap('claude', 'busy', 'working'), snap('codex', 'busy', 'working')], scannedAt: now };
    case 'approval':
      return {
        snapshots: [snap('claude', 'busy', 'working'), snap('codex', 'busy', 'waiting for approval')],
        scannedAt: now,
      };
    default:
      return { snapshots: [snap('claude', 'idle'), snap('codex', 'idle')], scannedAt: now };
  }
}

function runSimulation(state: SimulatedState): void {
  simulated = buildSimulatedSummary(state);
  if (simulateTimer) clearTimeout(simulateTimer);
  simulateTimer = setTimeout(() => {
    simulated = null;
    void runScan(false);
  }, 8000);
  applyVisuals(simulated);
}

function applyLoginItemSetting(on: boolean): void {
  try {
    app.setLoginItemSettings({ openAtLogin: on, args: on ? ['--watch'] : [] });
  } catch (e) {
    console.error('[login]', e);
  }
}

const APP_LOCK = path.join(configDir(), 'app.lock');

function writeAppLock(): void {
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(APP_LOCK, String(process.pid));
  } catch (e) {
    console.error('[lock]', e);
  }
}

function removeAppLock(): void {
  try {
    fs.unlinkSync(APP_LOCK);
  } catch {
    /* ignore */
  }
}

function toggleLight(): void {
  lightEnabled = !lightEnabled;
  const cfg = loadConfig();
  cfg.light.enabled = lightEnabled;
  saveConfig(cfg);
  if (lightEnabled) {
    const pos =
      cfg.light.x !== null && cfg.light.y !== null
        ? { x: cfg.light.x, y: cfg.light.y }
        : defaultLightPosition();
    createLightWindow(path.join(resourcesDir, 'light.html'), pos.x, pos.y, saveLightPosition);
    const light = statusFor(summary);
    updateLight({ color: light.color, blink: light.blink });
  } else {
    destroyLight();
  }
  updateTray(resourcesDir, summary, startAtLogin, lightEnabled, trayHandlers);
}

function saveLightPosition(x: number, y: number): void {
  const cfg = loadConfig();
  cfg.light.x = x;
  cfg.light.y = y;
  saveConfig(cfg);
}

function kindOf(snap: AgentSnapshot): NotificationKind | null {
  if (snap.state === 'busy') {
    if (snap.detail?.includes('approval')) return 'waiting-for-approval';
    if (snap.detail?.includes('your input')) return 'waiting-for-input';
    return 'busy';
  }
  if (snap.state === 'idle') return 'idle';
  return null;
}

function handleNotifications(snap: AgentSnapshot): void {
  const client = snap.client;
  const kind = kindOf(snap);
  const prev = prevKind.get(client);
  prevKind.set(client, kind);
  if (kind === null || kind === prev) return;

  const name = CLIENT_NAME[client];
  const icon = path.join(resourcesDir, `${client}.png`);
  const body = `${name}: ${snap.detail ?? snap.state}`;
  if (kind === 'waiting-for-approval') {
    notify(client, kind, `${name} needs your approval`, body, icon);
  } else if (kind === 'waiting-for-input') {
    notify(client, kind, `${name} is waiting for your input`, body, icon);
  } else if (kind === 'busy') {
    notify(client, kind, `${name} is working`, body, icon);
  } else if (kind === 'idle') {
    notify(client, kind, `${name} finished`, body, icon);
  }
}

async function runScan(forceCredits: boolean): Promise<void> {
  try {
    const config = loadConfig();
    const result = await scanAll(config);
    summary = result.summary;

    // Attach cached credits to the claude row.
    if (lastClaudeCredits) {
      const claudeSnap = summary.snapshots.find((s) => s.client === 'claude');
      if (claudeSnap) claudeSnap.credits = lastClaudeCredits;
    }

    for (const snap of summary.snapshots) handleNotifications(snap);

    if (config.keepAwakeEnabled) setKeepAwake(result.anyBusy);

    const now = Date.now();
    if (forceCredits || now - lastCreditScanAt > config.credit.refreshIntervalSec * 1000) {
      lastCreditScanAt = now;
      const credits = await scanClaudeCredits(config.credit);
      lastClaudeCredits = credits;
      const claudeSnap = summary.snapshots.find((s) => s.client === 'claude');
      if (claudeSnap) claudeSnap.credits = credits;
    }

    if (!simulated) applyVisuals(summary);
  } catch (e) {
    console.error('[scan]', e);
  }
}

const trayHandlers: TrayHandlers = {
  onRefresh: () => void runScan(true),
  onToggleStartAtLogin: () => {
    startAtLogin = !startAtLogin;
    const cfg = loadConfig();
    cfg.openAtLogin = startAtLogin;
    saveConfig(cfg);
    applyLoginItemSetting(startAtLogin);
    updateTray(resourcesDir, summary, startAtLogin, lightEnabled, trayHandlers);
  },
  onToggleDesktopLight: () => toggleLight(),
  onSimulate: (state) => runSimulation(state),
  onQuit: () => app.quit(),
};

const isWatchMode = process.argv.includes('--watch');

if (isWatchMode) {
  app.whenReady().then(() => startWatch());
} else {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    writeAppLock();
    app.on('will-quit', removeAppLock);
    app.on('second-instance', () => app.quit());

    app.whenReady().then(() => {
      app.setAppUserModelId('com.zhuhuibin.AgentStatusBar');

      resourcesDir = app.isPackaged
        ? path.join(process.resourcesPath, 'resources')
        : path.join(app.getAppPath(), 'resources');

      const config = loadConfig();
      startAtLogin = config.openAtLogin;
      lightEnabled = config.light.enabled;
      if (startAtLogin) applyLoginItemSetting(true);

      createTray(resourcesDir, trayHandlers, startAtLogin, lightEnabled);

      if (lightEnabled) {
        const pos =
          config.light.x !== null && config.light.y !== null
            ? { x: config.light.x, y: config.light.y }
            : defaultLightPosition();
        createLightWindow(path.join(resourcesDir, 'light.html'), pos.x, pos.y, saveLightPosition);
      }

      void runScan(true);
      setInterval(() => void runScan(false), config.scanIntervalSec * 1000);
    });

    app.on('window-all-closed', () => {
      /* keep running in tray */
    });
  }
}
