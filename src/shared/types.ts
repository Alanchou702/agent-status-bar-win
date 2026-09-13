/** Shared data models, ported from the macOS Swift app's types. */

export type AgentClient = 'claude' | 'codex';

/** Active working / process alive but not actively running / nothing running / undetermined. */
export type AgentState = 'busy' | 'running' | 'idle' | 'unknown';

export interface ProcInfo {
  pid: number;
  ppid: number;
  name: string;
  cmd: string;
  startedAt?: number;
}

export interface ClaudeSessionInfo {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number; // ms epoch
  updatedAt: number; // ms epoch
  version?: string;
  kind?: string;
  status?: string; // e.g. 'busy', 'interactive'
  title?: string;
  name?: string;
}

export interface CodexThreadInfo {
  threadId: string;
  title: string;
  cwd: string;
  updatedAt: number; // ms epoch
  rolloutPath?: string;
  archived?: boolean;
  source?: string;
  nickname?: string;
}

/** Raw timestamps (ms epoch) from the codex logs_2.sqlite state machine. 0 = no event. */
export interface CodexActivity {
  latest: number;
  taskStart: number;
  taskClose: number;
  escalatedExec: number;
  approvalRequest: number;
  approvalResponse?: number;
  execTool: number;
  userInputRequest: number;
  userInputResult: number;
  interrupt: number;
  anyTurnActivity: number;
  anyToolCall: number;
  anyToolResult: number;
  turnFollowUp: number;
  turnComplete: number;
}

export interface CreditSnapshot {
  available: boolean;
  fiveHourRemainingPercent?: number;
  fiveHourResetAt?: number; // ms epoch
  weeklyRemainingPercent?: number;
  weeklyResetAt?: number; // ms epoch
  subscriptionType?: string;
  error?: string;
}

export interface AgentSnapshot {
  client: AgentClient;
  state: AgentState;
  detail?: string;
  /** The agent's last assistant tool call was Claude Code's Delete tool. */
  deleting?: boolean;
  /** The agent just finished a turn/response (shown as a brief marquee). */
  done?: boolean;
  claude?: ClaudeSessionInfo;
  codex?: CodexThreadInfo;
  credits?: CreditSnapshot;
  scannedAt: number;
  /** Latest actual session activity, distinct from poll time. */
  activityAt?: number;
}

export interface AgentSummary {
  snapshots: AgentSnapshot[];
  scannedAt: number;
  warnings?: string[];
}
