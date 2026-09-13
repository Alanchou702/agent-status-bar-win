import { Menu, Tray, nativeImage, type NativeImage } from 'electron';
import * as path from 'node:path';
import type { PanelState } from '../shared/panel.js';
import type { StatusLight } from './statusLight.js';
import type { DisplayState } from '../shared/status.js';

export type SimulatedState = DisplayState;
export interface TrayHandlers {
  onRefresh: () => void; onToggleStartAtLogin: () => void; onToggleDesktopLight: () => void;
  onToggleMonitoring: () => void; onOpenSettings: () => void;
  onSimulate: (state: SimulatedState) => void; onQuit: () => void; onShowPanel: () => void;
}
let tray: Tray | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let lastLight = '';
let lastMenu = '';
const images = new Map<string, NativeImage>();
function icon(resources: string, name: string): NativeImage {
  const file = path.join(resources, name);
  if (!images.has(file)) images.set(file, nativeImage.createFromPath(file));
  return images.get(file)!;
}
export function createTray(resources: string, handlers: TrayHandlers): void {
  tray = new Tray(icon(resources, 'tray-idle.ico'));
  tray.setToolTip('Agent Signal Bar · 正在连接');
  tray.on('click', handlers.onShowPanel);
}
export function updateTray(state: PanelState, handlers: TrayHandlers): void {
  if (!tray) return;
  const signature = JSON.stringify([state.status.state, state.paused, state.simulated, state.settings, state.agents]);
  if (signature === lastMenu) return;
  lastMenu = signature;
  tray.setToolTip(`Agent Signal Bar · ${state.status.label}${state.simulated ? '（模拟）' : ''}`);
  const simulation: [DisplayState, string][] = [['idle', '未运行'], ['running', '待命'], ['busy', '工作中'], ['approval', '等待审批'], ['input', '等待输入'], ['deleting', '删除文件'], ['done', '任务完成'], ['unknown', '状态不可用']];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开状态面板', click: handlers.onShowPanel },
    { label: '设置', click: handlers.onOpenSettings },
    { type: 'separator' },
    ...state.agents.map(a => ({ label: `${a.client === 'claude' ? 'Claude Code' : 'Codex'} · ${state.paused ? '已暂停' : a.status.label}${a.client === 'codex' && a.sessionCount ? ' · ' + a.sessionCount + ' 个会话' : ''}`, enabled: false })),
    { type: 'separator' },
    { label: state.paused ? '恢复监控' : '暂停监控', click: handlers.onToggleMonitoring },
    { label: '刷新状态', enabled: !state.paused, click: handlers.onRefresh },
    { label: '显示桌面灯', type: 'checkbox', checked: state.settings.lightEnabled, click: handlers.onToggleDesktopLight },
    { label: '登录时启动', type: 'checkbox', checked: state.settings.openAtLogin, click: handlers.onToggleStartAtLogin },
    { label: '预览信号灯（8 秒）', submenu: simulation.map(([value, label]) => ({ label, click: () => handlers.onSimulate(value) })) },
    { type: 'separator' },
    { label: '退出', click: handlers.onQuit },
  ]));
}
export function setTrayLight(resources: string, light: StatusLight): void {
  if (!tray) return;
  const signature = JSON.stringify(light);
  if (signature === lastLight) return;
  lastLight = signature;
  if (timer) clearInterval(timer);
  timer = null;
  const active = icon(resources, light.frames[0]);
  tray.setImage(active);
  if (light.blink) {
    let on = true;
    const dim = icon(resources, 'tray-idle.ico');
    timer = setInterval(() => { on = !on; tray?.setImage(on ? active : dim); }, light.frameMs);
  }
}
export function destroyTray(): void {
  if (timer) clearInterval(timer);
  timer = null;
  tray?.destroy();
  tray = null;
  images.clear();
}

