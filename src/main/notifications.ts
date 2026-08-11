/** System notifications on agent state changes, deduped per client+kind. */

import type { AgentClient } from '../shared/types.js';

export type NotificationKind = 'busy' | 'waiting-for-approval' | 'waiting-for-input' | 'idle' | 'running';

const COOLDOWN_MS = 60_000;
const lastSent = new Map<string, number>();

function keyOf(client: AgentClient, kind: NotificationKind): string {
  return `${client}:${kind}`;
}

function electronNotification(): typeof import('electron').Notification | undefined {
  try {
    const { Notification } = require('electron') as typeof import('electron');
    return Notification;
  } catch {
    return undefined;
  }
}

/** Send a notification unless the same client+kind fired within the cooldown. */
export function notify(
  client: AgentClient,
  kind: NotificationKind,
  title: string,
  body: string,
  iconPath?: string
): boolean {
  const now = Date.now();
  const key = keyOf(client, kind);
  const last = lastSent.get(key) ?? 0;
  if (now - last < COOLDOWN_MS) return false;

  const Notification = electronNotification();
  if (!Notification || !Notification.isSupported()) return false;

  try {
    const opts: Electron.NotificationConstructorOptions = { title, body, silent: true };
    if (iconPath) opts.icon = iconPath;
    new Notification(opts).show();
    lastSent.set(key, now);
    return true;
  } catch {
    return false;
  }
}
