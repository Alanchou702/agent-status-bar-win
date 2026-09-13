import { BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'node:path';
import type { PanelState } from '../shared/panel.js';

let panel: BrowserWindow | null = null;
export interface PanelHandlers {
  state: () => PanelState;
  action: (action: string) => void;
  settings: (value: unknown) => void;
}
interface Client { window: BrowserWindow; view: string; hide: () => void }
const clients = new Map<number, Client>();
let handlers: PanelHandlers;
export function registerPanelClient(window: BrowserWindow, hide: () => void = () => window.hide()): void {
  clients.set(window.webContents.id, { window, hide, view: 'overview' });
  const id = window.webContents.id;
  window.once('closed', () => clients.delete(id));
}
function trusted(event: Electron.IpcMainInvokeEvent): Client {
  const client = clients.get(event.sender.id);
  if (!client || event.senderFrame !== client.window.webContents.mainFrame) throw new Error('不支持的请求来源');
  return client;
}
export function createPanelWindow(resourcesDir: string, nextHandlers: PanelHandlers): BrowserWindow {
  handlers = nextHandlers;
  const win = new BrowserWindow({
    width: 410, height: 610, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, show: false, skipTaskbar: true, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  panel = win;
  registerPanelClient(win);
  ipcMain.handle('panel:get-state', event => { trusted(event); return handlers.state(); });
  ipcMain.handle('panel:action', (event, action: unknown) => {
    const client = trusted(event);
    if (action === 'hide') client.hide();
    else if (action === 'view:settings') client.view = 'settings';
    else if (action === 'view:overview') client.view = 'overview';
    else if (typeof action === 'string' && ['refresh', 'toggle-monitoring', 'quit'].includes(action)) handlers.action(action);
    else throw new Error('不支持的操作');
  });
  ipcMain.handle('panel:settings', (event, value: unknown) => { trusted(event); handlers.settings(value); return handlers.state(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('panel-state', handlers.state());
    win.webContents.send('panel-view', clients.get(win.webContents.id)?.view ?? 'overview');
  });
  void win.loadFile(path.join(resourcesDir, 'panel.html'));
  win.on('blur', () => { if (clients.get(win.webContents.id)?.view !== 'settings') win.hide(); });
  win.on('closed', () => { panel = null; });
  return win;
}
export function showPanel(nextView = 'overview'): void {
  if (!panel || panel.isDestroyed()) return;
  const client = clients.get(panel.webContents.id);
  if (client) client.view = nextView;
  const cursor = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(cursor).workArea;
  const width = Math.min(410, area.width);
  const height = Math.min(610, area.height);
  panel.setBounds({ width, height,
    x: Math.round(Math.max(area.x, Math.min(cursor.x - width / 2, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(cursor.y + 12, area.y + area.height - height))) });
  panel.webContents.send('panel-view', nextView);
  panel.show();
  panel.focus();
}
export function updatePanel(state: PanelState): void {
  for (const { window } of clients.values()) {
    if (!window.isDestroyed() && !window.webContents.isLoading()) window.webContents.send('panel-state', state);
  }
}
export function destroyPanel(): void {
  panel?.destroy(); panel = null;
  for (const channel of ['panel:get-state', 'panel:action', 'panel:settings']) ipcMain.removeHandler(channel);
}

