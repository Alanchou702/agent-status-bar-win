import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { configDir, loadConfig, saveConfig, type AppConfig } from './config.js';
import { createLightWindow, defaultLightPosition, destroyLight, updateLight } from './desktopLight.js';
import { setKeepAwake } from './keepAwake.js';
import { notify } from './notifications.js';
import { playStatusSound } from './sounds.js';
import { scanClaudeCredits } from './scanner/creditScanner.js';
import { scanInWorker } from './scanner/scanService.js';
import { statusFor } from './statusLight.js';
import { createTray, destroyTray, setTrayLight, updateTray, type TrayHandlers } from './tray.js';
import { createPanelWindow, destroyPanel, showPanel, updatePanel } from './panel.js';
import { Monitor, userSettings } from './monitor.js';
import type { UserSettings } from '../shared/panel.js';
import { startWatch } from './watch.js';
import { loginTarget } from './startup.js';

let monitor: Monitor | undefined;
let config: AppConfig;
let resources = '';
const lockFile = path.join(configDir(), 'app.lock');

function applyLogin(on: boolean): void {
  // Development runs must include the absolute app path.
  app.setLoginItemSettings({ openAtLogin: on, ...loginTarget(app.isPackaged, process.execPath, app.getAppPath(), process.env.PORTABLE_EXECUTABLE_FILE) });
}
function applyLight(): void {
  if (!config.light.enabled) { destroyLight(); return; }
  const pos = config.light.x !== null && config.light.y !== null ? { x: config.light.x, y: config.light.y } : defaultLightPosition();
  createLightWindow(path.join(resources, 'light.html'), pos.x, pos.y, (x, y) => {
    config.light.x = x; config.light.y = y;
    try { saveConfig(config); } catch (error) { console.error('[position]', error); }
  });
  if (monitor) updateLight(statusFor(monitor.getState().summary, monitor.getState().paused));
}
function saveSettings(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('设置格式不正确');
  const input = value as Record<string, unknown>;
  const expected = userSettings(config);
  for (const key of Object.keys(expected) as (keyof UserSettings)[]) {
    if (key === 'scanIntervalSec') {
      if (typeof input[key] !== 'number' || !Number.isInteger(input[key]) || input[key] < 2 || input[key] > 60) throw new Error('刷新间隔应为 2–60 秒');
    } else if (typeof input[key] !== 'boolean') throw new Error('设置格式不正确');
  }
  const settings = input as unknown as UserSettings;
  const next = structuredClone(config);
  next.scanIntervalSec = settings.scanIntervalSec;
  next.openAtLogin = settings.openAtLogin;
  next.keepAwakeEnabled = settings.keepAwakeEnabled;
  next.notificationsEnabled = settings.notificationsEnabled;
  next.soundEnabled = settings.soundEnabled;
  next.light.enabled = settings.lightEnabled;
  next.credit.enabled = settings.creditEnabled;
  if (next.openAtLogin !== config.openAtLogin) applyLogin(next.openAtLogin);
  try { saveConfig(next); }
  catch (error) {
    if (next.openAtLogin !== config.openAtLogin) applyLogin(config.openAtLogin);
    throw error;
  }
  const lightChanged = config.light.enabled !== next.light.enabled;
  config = next;
  if (lightChanged) applyLight();
  monitor!.configure(config);
}
const handlers: TrayHandlers = {
  onRefresh: () => { void monitor?.refresh(true); },
  onToggleStartAtLogin: () => saveSettings({ ...userSettings(config), openAtLogin: !config.openAtLogin }),
  onToggleDesktopLight: () => saveSettings({ ...userSettings(config), lightEnabled: !config.light.enabled }),
  onToggleMonitoring: () => monitor?.togglePaused(),
  onOpenSettings: () => showPanel('settings'),
  onShowPanel: () => showPanel(),
  onSimulate: state => monitor?.simulate(state),
  onQuit: () => app.quit(),
};

if (process.argv.includes('--watch')) {
  void app.whenReady().then(startWatch);
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (app.isReady()) showPanel(); });
  app.on('window-all-closed', () => { /* Tray application remains available. */ });
  app.on('before-quit', () => {
    monitor?.stop();
    destroyTray(); destroyLight(); destroyPanel();
    try {
      if (fs.readFileSync(lockFile, 'utf8') === String(process.pid)) fs.unlinkSync(lockFile);
    } catch { /* No lock to clean. */ }
  });
  void app.whenReady().then(() => {
    app.setAppUserModelId('com.zhuhuibin.AgentStatusBar');
    resources = app.isPackaged ? path.join(process.resourcesPath, 'resources') : path.join(app.getAppPath(), 'resources');
    config = loadConfig();
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(lockFile, String(process.pid));
    // Test/dev launches can opt out without changing the user's login settings.
    if (!process.env.AGENT_BAR_CONFIG_DIR) {
      try { applyLogin(config.openAtLogin); } catch (error) { console.error('[login]', error); }
    }
    monitor = new Monitor(config, {
      scan: scanInWorker, credits: scanClaudeCredits, keepAwake: setKeepAwake,
      publish: state => {
        const light = statusFor(state.summary, state.paused);
        updateLight(light); setTrayLight(resources, light);
        updateTray(state, handlers); updatePanel(state);
      },
      transition: event => {
        const name = event.client === 'claude' ? 'Claude Code' : 'Codex';
        const kind = event.state === 'approval' ? 'waiting-for-approval' : event.state === 'input' ? 'waiting-for-input' : 'idle';
        if (config.soundEnabled) playStatusSound(resources, event.state);
        if (!config.notificationsEnabled) return;
        notify(event.client, kind, `${name} · ${event.label}`,
          `${event.sessionTitle || (event.sessionId ? '会话 ' + event.sessionId.slice(0, 8) : name)} · ${event.state === 'done' ? '任务结果已就绪。' : '需要你处理。'}`, path.join(resources, `${event.client}.png`), event.sessionId);
      },
    });
    createPanelWindow(resources, {
      state: () => monitor!.getState(), settings: saveSettings,
      action: action => {
        if (action === 'refresh') handlers.onRefresh();
        if (action === 'toggle-monitoring') handlers.onToggleMonitoring();
        if (action === 'quit') handlers.onQuit();
      },
    });
    createTray(resources, handlers);
    applyLight();
    void monitor.refresh(true);
    if (process.argv.includes('--show')) showPanel();
  }).catch(error => { console.error('[startup]', error); app.quit(); });
}

