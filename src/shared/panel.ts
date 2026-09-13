import type { AgentClient, AgentSummary } from './types.js';
import type { DisplayState, StatusPresentation } from './status.js';

export interface UserSettings {
  scanIntervalSec: number;
  keepAwakeEnabled: boolean;
  openAtLogin: boolean;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  lightEnabled: boolean;
  creditEnabled: boolean;
}
export interface ActivityEvent {
  id: number;
  client: AgentClient;
  state: DisplayState;
  label: string;
  at: number;
  sessionId?: string;
  sessionTitle?: string;
}
export interface PanelState {
  summary: AgentSummary;
  status: StatusPresentation;
  agents: { client: AgentClient; status: StatusPresentation; sessionCount?: number; activeCount?: number }[];
  sessions?: { id: string; title: string; cwd: string; source: string; status: StatusPresentation; activityAt: number }[];
  events: ActivityEvent[];
  paused: boolean;
  scanning: boolean;
  simulated: boolean;
  error: string | null;
  settings: UserSettings;
}
