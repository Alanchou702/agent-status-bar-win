import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface CreditConfig {
  enabled: boolean;
  endpoint: string;
  credentialsPath?: string;
  refreshIntervalSec: number;
}

export interface LightConfig {
  enabled: boolean;
  x: number | null;
  y: number | null;
}

export interface AppConfig {
  scanIntervalSec: number;
  keepAwakeEnabled: boolean;
  openAtLogin: boolean;
  claudeBusyFreshnessMs: number;
  codexTurnActivityFreshnessMs: number;
  codexThreadLookupWindowSec: number;
  credit: CreditConfig;
  light: LightConfig;
  paths: {
    claudeSessionsDir: string;
    claudeProjectsDir: string;
    codexLogsDb: string;
    codexStateDb: string;
  };
}

const home = os.homedir();

const defaults: AppConfig = {
  scanIntervalSec: 3,
  keepAwakeEnabled: true,
  openAtLogin: true,
  claudeBusyFreshnessMs: 30_000,
  codexTurnActivityFreshnessMs: 30_000,
  codexThreadLookupWindowSec: 2 * 3600,
  credit: {
    enabled: true,
    endpoint: 'https://api.anthropic.com/api/oauth/usage',
    refreshIntervalSec: 600,
  },
  light: {
    enabled: true,
    x: null,
    y: null,
  },
  paths: {
    claudeSessionsDir: path.join(home, '.claude', 'sessions'),
    claudeProjectsDir: path.join(home, '.claude', 'projects'),
    codexLogsDb: path.join(home, '.codex', 'logs_2.sqlite'),
    codexStateDb: path.join(home, '.codex', 'state_5.sqlite'),
  },
};

export function configDir(): string {
  return path.join(process.env.APPDATA ?? home, 'agent-status-bar');
}

export function configFile(): string {
  return path.join(configDir(), 'config.json');
}

function deepMerge<T>(base: T, override: Partial<T> | undefined): T {
  if (!override) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    const baseV = (base as Record<string, unknown>)[k];
    if (
      v !== undefined &&
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      baseV !== undefined &&
      typeof baseV === 'object' &&
      !Array.isArray(baseV)
    ) {
      out[k] = deepMerge(baseV as Record<string, unknown>, v as Record<string, unknown>);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

export function loadConfig(): AppConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(), 'utf-8')) as Partial<AppConfig>;
    return deepMerge(defaults, raw);
  } catch {
    return {
      ...defaults,
      paths: { ...defaults.paths },
      credit: { ...defaults.credit },
      light: { ...defaults.light },
    };
  }
}

export function saveConfig(config: AppConfig): void {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2), 'utf-8');
}
