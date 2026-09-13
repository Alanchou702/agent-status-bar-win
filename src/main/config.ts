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
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  claudeBusyFreshnessMs: number;
  codexTurnActivityFreshnessMs: number;
  taskCompleteFreshnessMs: number;
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

const userHomeDir = os.homedir();

const defaults: AppConfig = {
  scanIntervalSec: 3,
  keepAwakeEnabled: true,
  openAtLogin: true,
  notificationsEnabled: true,
  soundEnabled: true,
  claudeBusyFreshnessMs: 30_000,
  codexTurnActivityFreshnessMs: 30_000,
  taskCompleteFreshnessMs: 5_000,
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
    claudeSessionsDir: path.join(userHomeDir, '.claude', 'sessions'),
    claudeProjectsDir: path.join(userHomeDir, '.claude', 'projects'),
    codexLogsDb: path.join(userHomeDir, '.codex', 'logs_2.sqlite'),
    codexStateDb: path.join(userHomeDir, '.codex', 'state_5.sqlite'),
  },
};

export function configDir(): string {
  return process.env.AGENT_BAR_CONFIG_DIR ?? path.join(process.env.APPDATA ?? userHomeDir, 'agent-status-bar');
}

export function configFile(): string {
  return path.join(configDir(), 'config.json');
}

export function loadConfig(): AppConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(), 'utf-8')) as Partial<AppConfig>;
    return normalizeConfig(raw as AppConfig);
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
  const temporary = `${configFile()}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(normalizeConfig(config), null, 2), 'utf-8');
  fs.renameSync(temporary, configFile());
}

export function normalizeConfig(value: AppConfig): AppConfig {
  const config = structuredClone(defaults);
  const raw = value as unknown as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') return config;
  for (const key of ['keepAwakeEnabled', 'openAtLogin', 'notificationsEnabled', 'soundEnabled'] as const) {
    if (typeof raw[key] === 'boolean') config[key] = raw[key];
  }
  for (const key of ['scanIntervalSec', 'claudeBusyFreshnessMs', 'codexTurnActivityFreshnessMs', 'taskCompleteFreshnessMs', 'codexThreadLookupWindowSec'] as const) {
    const n = raw[key];
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) config[key] = n;
  }
  config.scanIntervalSec = Math.min(60, Math.max(2, config.scanIntervalSec));
  const light = raw.light as Partial<LightConfig> | null;
  if (light && typeof light === 'object') {
    if (typeof light.enabled === 'boolean') config.light.enabled = light.enabled;
    for (const key of ['x', 'y'] as const) {
      if (typeof light[key] === 'number' && Number.isFinite(light[key])) config.light[key] = Math.round(light[key]!);
    }
  }
  const credit = raw.credit as Partial<CreditConfig> | null;
  if (credit && typeof credit === 'object') {
    if (typeof credit.enabled === 'boolean') config.credit.enabled = credit.enabled;
    if (typeof credit.endpoint === 'string' && credit.endpoint.startsWith('https://')) config.credit.endpoint = credit.endpoint;
    if (typeof credit.credentialsPath === 'string') config.credit.credentialsPath = credit.credentialsPath;
    if (typeof credit.refreshIntervalSec === 'number' && Number.isFinite(credit.refreshIntervalSec)) config.credit.refreshIntervalSec = Math.max(60, credit.refreshIntervalSec);
  }
  const paths = raw.paths as Partial<AppConfig['paths']> | null;
  if (paths && typeof paths === 'object') {
    for (const key of Object.keys(config.paths) as (keyof AppConfig['paths'])[]) {
      if (typeof paths[key] === 'string' && paths[key]!.trim()) config.paths[key] = paths[key]!;
    }
  }
  return config;
}
