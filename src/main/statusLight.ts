import type { AgentSummary } from '../shared/types.js';

export type FloatingLightState = 'idle' | 'running' | 'busy' | 'approval' | 'unknown';

export interface StatusLight {
  state: FloatingLightState;
  color: string;
  blink: boolean;
  blinkIcon: string | null;
}

/** Aggregate both agents into a single status light, matching the tray icon. */
export function statusFor(summary: AgentSummary): StatusLight {
  const anyApproval = summary.snapshots.some(
    (s) => s.state === 'busy' && !!s.detail && /approval|permission/i.test(s.detail)
  );
  const anyBusy = summary.snapshots.some((s) => s.state === 'busy');
  const anyRunning = summary.snapshots.some((s) => s.state === 'running');
  const anyUnknown = summary.snapshots.some((s) => s.state === 'unknown');
  if (anyApproval) return { state: 'approval', color: '#ff4d4f', blink: true, blinkIcon: 'tray-approval.ico' };
  if (anyBusy) return { state: 'busy', color: '#3cc85a', blink: true, blinkIcon: 'tray-busy.ico' };
  if (anyUnknown) return { state: 'unknown', color: '#f8bd35', blink: true, blinkIcon: 'tray-busy.ico' };
  if (anyRunning) return { state: 'running', color: '#4682ff', blink: false, blinkIcon: null };
  return { state: 'idle', color: '#969696', blink: false, blinkIcon: null };
}
