import { BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'node:path';
import type { StatusLight } from './statusLight.js';
import { registerPanelClient } from './panel.js';
import { expandedBounds, type Rect } from './floatingGeometry.js';

export type LightState = StatusLight;
let lightWin: BrowserWindow | null = null;
let latestState: LightState | null = null;
let compact: Rect = { x: 0, y: 0, width: 360, height: 52 };
let expanded = false;
let collapsing = false;
let dragging = false;
let dragOrigin: { pointerX: number; pointerY: number; x: number; y: number } | null = null;
let enterTimer: ReturnType<typeof setTimeout> | null = null;
let leaveTimer: ReturnType<typeof setTimeout> | null = null;
let resizeTimer: ReturnType<typeof setTimeout> | null = null;
let savePosition: ((x: number, y: number) => void) | null = null;

export function defaultLightPosition(): { x: number; y: number } {
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + area.width - 372, y: area.y + 12 };
}
function clamp(rect: Rect): Rect {
  const area = screen.getDisplayNearestPoint({ x: rect.x, y: rect.y }).workArea;
  return { ...rect, x: Math.max(area.x, Math.min(rect.x, area.x + area.width - rect.width)),
    y: Math.max(area.y, Math.min(rect.y, area.y + area.height - rect.height)) };
}
function clearTimers(): void {
  if (enterTimer) clearTimeout(enterTimer);
  if (leaveTimer) clearTimeout(leaveTimer);
  enterTimer = null; leaveTimer = null;
}
function sendShell(open: boolean): void {
  if (!lightWin || lightWin.isDestroyed()) return;
  const bounds = lightWin.getBounds();
  lightWin.webContents.send('floating-shell', { expanded: open, width: bounds.width, height: bounds.height,
    compactX: compact.x - bounds.x, compactY: compact.y - bounds.y });
}
function expand(): void {
  if (!lightWin || lightWin.isDestroyed() || dragging) return;
  clearTimers();
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = null;
  if (expanded && !collapsing) return;
  if (!expanded) compact = clamp(lightWin.getBounds());
  expanded = true; collapsing = false;
  const area = screen.getDisplayNearestPoint({ x: compact.x, y: compact.y }).workArea;
  lightWin.setBounds(expandedBounds(compact, area), false);
  lightWin.setFocusable(true);
  // showInactive: hovering must not steal keyboard focus from the coding agent.
  lightWin.showInactive();
  sendShell(true);
}
function collapse(): void {
  clearTimers();
  if (!lightWin || !expanded || dragging || collapsing) return;
  collapsing = true;
  sendShell(false);
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    if (!lightWin || lightWin.isDestroyed()) return;
    expanded = false; collapsing = false;
    lightWin.setFocusable(false);
    compact = clamp(compact);
    lightWin.setBounds(compact, false);
    sendShell(false);
  }, 260);
}
export function createLightWindow(htmlPath: string, x: number, y: number, save: (x: number, y: number) => void): BrowserWindow {
  if (lightWin && !lightWin.isDestroyed()) return lightWin;
  savePosition = save;
  compact = clamp({ x, y, width: 360, height: 52 });
  expanded = false; collapsing = false; dragging = false;
  const win = new BrowserWindow({
    ...compact, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, movable: false, alwaysOnTop: true, skipTaskbar: true, focusable: false,
    hasShadow: false, fullscreenable: false, show: false, roundedCorners: false, thickFrame: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  lightWin = win;
  registerPanelClient(win, collapse);
  ipcMain.handle('floating:pointer', (event, action: unknown) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('不支持的请求来源');
    if (action === 'drag-start' && !expanded) {
      clearTimers(); dragging = true;
      const point = screen.getCursorScreenPoint();
      dragOrigin = { pointerX: point.x, pointerY: point.y, x: compact.x, y: compact.y };
    } else if (action === 'drag-move' && dragging && dragOrigin) {
      const point = screen.getCursorScreenPoint();
      compact = clamp({ ...compact, x: dragOrigin.x + point.x - dragOrigin.pointerX, y: dragOrigin.y + point.y - dragOrigin.pointerY });
      win.setPosition(compact.x, compact.y, false);
    } else if (action === 'drag-end' && dragging) {
      const moved = dragOrigin && (Math.abs(compact.x - dragOrigin.x) > 3 || Math.abs(compact.y - dragOrigin.y) > 3);
      dragging = false; dragOrigin = null;
      if (moved) savePosition?.(compact.x, compact.y);
    }
  });
  win.setAlwaysOnTop(true, 'floating');
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('did-finish-load', () => {
    if (latestState) win.webContents.send('light-state', latestState);
    sendShell(false);
  });
  void win.loadFile(path.join(path.dirname(htmlPath), 'panel.html'), { query: { floating: '1' } });
  win.once('ready-to-show', () => win.showInactive());
  win.on('closed', () => {
    clearTimers(); if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = null; lightWin = null; ipcMain.removeHandler('floating:pointer');
  });
  return win;
}
export function updateLight(state: LightState): void {
  latestState = state;
  if (lightWin && !lightWin.isDestroyed() && !lightWin.webContents.isLoading()) lightWin.webContents.send('light-state', state);
}
export function isLightVisible(): boolean { return !!lightWin && !lightWin.isDestroyed(); }
export function destroyLight(): void {
  clearTimers(); if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = null; lightWin?.destroy(); lightWin = null;
}

