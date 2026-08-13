import { BrowserWindow, screen } from 'electron';
import type { StatusLight } from './statusLight.js';

export type LightState = StatusLight;

let lightWin: BrowserWindow | null = null;
let onMoveSave: ((x: number, y: number) => void) | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let latestState: LightState | null = null;

export function defaultLightPosition(): { x: number; y: number } {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - 132, y: wa.y + 12 };
}

export function createLightWindow(
  htmlPath: string,
  x: number,
  y: number,
  save: (x: number, y: number) => void
): BrowserWindow {
  onMoveSave = save;
  lightWin = new BrowserWindow({
    width: 120,
    height: 80,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    fullscreenable: false,
    show: false,
    x,
    y,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  lightWin.setAlwaysOnTop(true, 'screen-saver');
  lightWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  lightWin.loadFile(htmlPath);
  lightWin.webContents.on('did-finish-load', () => {
    if (latestState && lightWin && !lightWin.isDestroyed()) lightWin.webContents.send('light-state', latestState);
  });
  lightWin.once('ready-to-show', () => lightWin?.show());

  lightWin.on('moved', () => {
    if (!lightWin) return;
    const [px, py] = lightWin.getPosition();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => onMoveSave?.(px, py), 300);
  });
  lightWin.on('closed', () => {
    lightWin = null;
  });
  return lightWin;
}

export function updateLight(state: LightState): void {
  latestState = state;
  if (lightWin && !lightWin.isDestroyed() && !lightWin.webContents.isLoading()) {
    lightWin.webContents.send('light-state', state);
  }
}

export function isLightVisible(): boolean {
  return !!lightWin && !lightWin.isDestroyed();
}

export function destroyLight(): void {
  if (lightWin && !lightWin.isDestroyed()) lightWin.destroy();
  lightWin = null;
}
