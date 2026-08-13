import { BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'node:path';
import type { AgentSummary } from '../shared/types.js';

let panel: BrowserWindow | null = null;
let panelHtml = '';
let actionHandlers: {
  onToggleMonitoring: () => void;
  onOpenSettings: () => void;
  onQuit: () => void;
} | null = null;

function positionPanel(): void {
  if (!panel || panel.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const bounds = display.workArea;
  const width = 340;
  const height = 430;
  const x = Math.max(bounds.x + 8, Math.min(cursor.x - 120, bounds.x + bounds.width - width - 8));
  const y = Math.max(bounds.y + 8, Math.min(cursor.y + 12, bounds.y + bounds.height - height - 8));
  panel.setPosition(Math.round(x), Math.round(y), false);
}

export function createPanelWindow(
  htmlPath: string,
  handlers: {
    onToggleMonitoring: () => void;
    onOpenSettings: () => void;
    onQuit: () => void;
  }
): BrowserWindow {
  panelHtml = htmlPath;
  actionHandlers = handlers;
  panel = new BrowserWindow({
    width: 340,
    height: 430,
    minWidth: 320,
    minHeight: 390,
    maxWidth: 420,
    maxHeight: 620,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    movable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  panel.setAlwaysOnTop(true, 'floating');
  panel.loadFile(panelHtml);
  panel.on('blur', () => {
    if (panel && !panel.isDestroyed()) panel.hide();
  });
  panel.on('closed', () => {
    panel = null;
  });
  return panel;
}

export function installPanelIpc(): void {
  ipcMain.on('panel-action', (_event, action: string) => {
    if (action === 'toggle-monitoring') actionHandlers?.onToggleMonitoring();
    if (action === 'open-settings') actionHandlers?.onOpenSettings();
    if (action === 'quit') actionHandlers?.onQuit();
    if (action === 'hide') panel?.hide();
  });
}

export function showPanel(summary: AgentSummary, paused: boolean): void {
  if (!panel || panel.isDestroyed()) return;
  positionPanel();
  panel.showInactive();
  panel.webContents.send('panel-state', { summary, paused });
}

export function updatePanel(summary: AgentSummary, paused: boolean): void {
  if (!panel || panel.isDestroyed() || !panel.isVisible()) return;
  panel.webContents.send('panel-state', { summary, paused });
}

export function destroyPanel(): void {
  if (panel && !panel.isDestroyed()) panel.destroy();
  panel = null;
}

export function panelPath(resourcesDir: string): string {
  return path.join(resourcesDir, 'panel.html');
}
