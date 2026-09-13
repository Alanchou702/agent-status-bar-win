import type { AppConfig } from './config.js';
import type { AgentSummary, CreditSnapshot, AgentClient, AgentState } from '../shared/types.js';
import type { ActivityEvent, PanelState, UserSettings } from '../shared/panel.js';
import { aggregateStatus, stateOf, STATUS, type DisplayState } from '../shared/status.js';
import type { ScanResult } from './scanner/scanAll.js';

interface Dependencies {
  scan: (config: AppConfig) => Promise<ScanResult>;
  credits: (config: AppConfig['credit']) => Promise<CreditSnapshot>;
  publish: (state: PanelState) => void;
  keepAwake: (on: boolean) => void;
  transition: (event: ActivityEvent) => void;
}
export function userSettings(config: AppConfig): UserSettings {
  return { scanIntervalSec: config.scanIntervalSec, openAtLogin: config.openAtLogin,
    keepAwakeEnabled: config.keepAwakeEnabled, notificationsEnabled: config.notificationsEnabled,
    soundEnabled: config.soundEnabled,
    lightEnabled: config.light.enabled, creditEnabled: config.credit.enabled };
}
export class Monitor {
  private summary: AgentSummary = { snapshots: [], scannedAt: 0 };
  private events: ActivityEvent[] = [];
  private previous = new Map<string, DisplayState>();
  private hasBaseline = false;
  private paused = false;
  private scanning = false;
  private stopped = false;
  private error: string | null = null;
  private generation = 0;
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private demoTimer: ReturnType<typeof setTimeout> | null = null;
  private demo: AgentSummary | null = null;
  private creditValue: CreditSnapshot | undefined;
  private creditPending = false;
  private creditAt = 0;
  constructor(private config: AppConfig, private deps: Dependencies) {}
  getState(): PanelState {
    const summary = structuredClone(this.demo ?? this.summary);
    if (this.config.credit.enabled && this.creditValue) {
      const claude = summary.snapshots.find(s => s.client === 'claude');
      if (claude) claude.credits = this.creditValue;
    }
    return { summary, status: aggregateStatus(summary, this.paused),
      agents: (['claude', 'codex'] as const).map(client => {
        const snapshots = summary.snapshots.filter(s => s.client === client);
        return { client, status: aggregateStatus({ snapshots, scannedAt: summary.scannedAt }),
          sessionCount: snapshots.filter(s => !!s.codex || !!s.claude).length,
          activeCount: snapshots.filter(s => s.state === 'busy').length };
      }),
      sessions: summary.snapshots.filter(s => s.client === 'codex' && s.codex).map(s => ({
        id: s.codex!.threadId, title: s.codex!.title || s.codex!.nickname || `会话 ${s.codex!.threadId.slice(0, 8)}`,
        cwd: s.codex!.cwd, source: !s.codex!.source ? '来源未知' : /subagent/i.test(s.codex!.source!) ? '子会话' : '主会话',
        status: s.state === 'idle' ? { ...STATUS.idle, label: '无近期活动' } : STATUS[stateOf(s)], activityAt: s.activityAt ?? s.codex!.updatedAt,
      })),
      paused: this.paused, scanning: this.scanning, simulated: this.demo !== null,
      error: this.error, events: [...this.events], settings: userSettings(this.config) };
  }
  private publish(): void { if (!this.stopped) this.deps.publish(this.getState()); }
  private power(): void {
    this.deps.keepAwake(!this.paused && !this.stopped && this.config.keepAwakeEnabled &&
      this.summary.snapshots.some(s => ['busy', 'deleting'].includes(stateOf(s))));
  }
  async refresh(forceCredits = false): Promise<void> {
    if (this.stopped || this.paused || this.scanning) return;
    if (this.timer) clearTimeout(this.timer);
    this.scanning = true;
    const generation = this.generation;
    this.publish();
    void this.refreshCredits(forceCredits);
    try {
      const result = await this.deps.scan(this.config);
      if (this.stopped || this.paused || generation !== this.generation) return;
      this.error = null;
      this.summary = result.summary;
      const observed = new Set<string>();
      for (const snapshot of result.summary.snapshots) {
        const next = stateOf(snapshot);
        const key = `${snapshot.client}:${snapshot.codex?.threadId ?? snapshot.claude?.sessionId ?? 'process'}`;
        observed.add(key);
        const previous = this.previous.get(key);
        this.previous.set(key, next);
        if (previous === next) continue;
        // The first observation is a baseline, never a synthetic completion.
        if (previous === undefined && next === 'idle') continue;
        const event: ActivityEvent = { id: ++this.sequence, client: snapshot.client, state: next, label: STATUS[next].label,
          at: result.summary.scannedAt, sessionId: snapshot.codex?.threadId ?? snapshot.claude?.sessionId,
          sessionTitle: snapshot.codex?.title || snapshot.codex?.nickname || snapshot.claude?.title };
        this.events.unshift(event);
        if ((previous !== undefined || this.hasBaseline) && (this.config.notificationsEnabled || this.config.soundEnabled) && ['approval', 'input', 'done'].includes(next)) this.deps.transition(event);
      }
      for (const key of this.previous.keys()) if (!observed.has(key)) this.previous.delete(key);
      this.hasBaseline = true;
      this.events = this.events.slice(0, 40);
      this.power();
    } catch (error) {
      if (generation !== this.generation || this.stopped) return;
      this.error = error instanceof Error ? error.message : String(error);
      this.summary = { scannedAt: Date.now(), snapshots: (['claude', 'codex'] as const).map(client =>
        ({ client, state: 'unknown', detail: 'scan failed', scannedAt: Date.now() })) };
      this.deps.keepAwake(false);
    } finally {
      this.scanning = false;
      this.publish();
      if (!this.stopped && !this.paused) {
        this.timer = setTimeout(() => void this.refresh(), generation !== this.generation ? 0 : this.config.scanIntervalSec * 1000);
      }
    }
  }
  private async refreshCredits(force: boolean): Promise<void> {
    if (!this.config.credit.enabled || this.creditPending || (!force && Date.now() - this.creditAt < this.config.credit.refreshIntervalSec * 1000)) return;
    this.creditPending = true;
    try { this.creditValue = await this.deps.credits(this.config.credit); }
    catch { this.creditValue = { available: false, error: '额度查询失败' }; }
    finally { this.creditPending = false; this.creditAt = Date.now(); this.publish(); }
  }
  togglePaused(): void {
    this.paused = !this.paused;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.clearDemo();
    this.power();
    this.publish();
    if (!this.paused) { this.previous.clear(); this.hasBaseline = false; void this.refresh(); }
  }
  configure(config: AppConfig): void {
    this.config = config;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.power();
    this.publish();
    void this.refresh(true);
  }
  simulate(state: DisplayState): void {
    this.clearDemo();
    const now = Date.now();
    const base: AgentState = state === 'approval' || state === 'input' || state === 'deleting' || state === 'busy' ? 'busy' : state === 'done' || state === 'running' ? 'running' : state === 'unknown' ? 'unknown' : 'idle';
    this.demo = { scannedAt: now, snapshots: [
      { client: 'claude', state: base, detail: state === 'approval' ? 'waiting for approval' : state === 'input' ? 'waiting for your input' : state,
        deleting: state === 'deleting', done: state === 'done', scannedAt: now },
      { client: 'codex', state: 'idle', scannedAt: now },
    ] };
    this.publish();
    this.demoTimer = setTimeout(() => { this.clearDemo(); this.publish(); }, 8000);
  }
  private clearDemo(): void { if (this.demoTimer) clearTimeout(this.demoTimer); this.demo = null; }
  stop(): void {
    this.stopped = true;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.clearDemo();
    this.deps.keepAwake(false);
  }
}

