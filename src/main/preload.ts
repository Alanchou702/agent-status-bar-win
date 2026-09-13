import { contextBridge, ipcRenderer } from 'electron';
import type { UserSettings } from '../shared/panel.js';

contextBridge.exposeInMainWorld('agentBar', {
  pointer: (action: string) => ipcRenderer.invoke('floating:pointer', action),
  onShell: (callback: (data: unknown) => void) => {
    const listener = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on('floating-shell', listener);
    return () => ipcRenderer.removeListener('floating-shell', listener);
  },
  getState: () => ipcRenderer.invoke('panel:get-state'),
  action: (action: string) => ipcRenderer.invoke('panel:action', action),
  saveSettings: (settings: UserSettings) => ipcRenderer.invoke('panel:settings', settings),
  onState: (callback: (data: unknown) => void) => {
    const listener = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on('panel-state', listener);
    return () => ipcRenderer.removeListener('panel-state', listener);
  },
  onLight: (callback: (data: unknown) => void) => {
    const listener = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on('light-state', listener);
    return () => ipcRenderer.removeListener('light-state', listener);
  },
  onView: (callback: (view: string) => void) => {
    const listener = (_event: unknown, view: string) => callback(view);
    ipcRenderer.on('panel-view', listener);
    return () => ipcRenderer.removeListener('panel-view', listener);
  },
});

