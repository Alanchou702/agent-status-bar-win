import type { AgentSummary } from '../shared/types.js';
import { aggregateStatus, type DisplayState } from '../shared/status.js';

export type FloatingLightState = DisplayState;
export interface StatusLight {
  state: DisplayState;
  label: string;
  color: string;
  blink: boolean;
  marquee: boolean;
  frames: string[];
  frameMs: number;
}
export function statusFor(summary: AgentSummary, paused = false): StatusLight {
  const status = aggregateStatus(summary, paused);
  const icon = status.state === 'approval' ? 'red' :
    ['input', 'deleting', 'unknown'].includes(status.state) ? 'yellow' :
    ['busy', 'done'].includes(status.state) ? 'green' : status.state === 'running' ? 'blue' : 'idle';
  return { ...status, blink: status.state === 'approval', marquee: false, frames: [`tray-${icon}.ico`], frameMs: 850 };
}

