import type { AgentSummary } from '../shared/types.js';

export interface StatusLight {
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
  if (anyApproval) return { color: '#ff4d4f', blink: true, blinkIcon: 'tray-approval.ico' };
  if (anyBusy) return { color: '#3cc85a', blink: true, blinkIcon: 'tray-busy.ico' };
  if (anyRunning) return { color: '#4682ff', blink: false, blinkIcon: null };
  return { color: '#969696', blink: false, blinkIcon: null };
}
