import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CreditSnapshot } from '../../shared/types.js';
import type { CreditConfig } from '../config.js';

/** Read the OAuth access token used by Claude Code for the Anthropic usage API. */
export function readAccessToken(credentialsPath: string | undefined): string | undefined {
  const candidates = credentialsPath
    ? [credentialsPath]
    : [path.join(os.homedir(), '.claude', '.credentials.json')];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const oauth = j.claudeAiOauth ?? j['claude-ai-oauth'];
      if (oauth && typeof oauth.accessToken === 'string' && oauth.accessToken) return oauth.accessToken;
    } catch {
      /* try next candidate */
    }
  }
  return undefined;
}

/** Fetch Claude usage/credit info. Resolves to a degraded snapshot on any failure. */
export async function scanClaudeCredits(config: CreditConfig): Promise<CreditSnapshot> {
  if (!config.enabled) return { available: false, error: 'disabled' };

  const token = readAccessToken(config.credentialsPath);
  if (!token) return { available: false, error: 'no credentials' };

  try {
    const res = await fetch(config.endpoint, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { available: false, error: `HTTP ${res.status}` };

    const j = (await res.json()) as Record<string, unknown>;
    return parseCreditResponse(j);

  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Supports the OAuth usage response as well as the original flat endpoint. */
export function parseCreditResponse(j: Record<string, unknown>): CreditSnapshot {
  const five = j.five_hour as { utilization?: number; resets_at?: string } | undefined;
  const week = j.seven_day as { utilization?: number; resets_at?: string } | undefined;
  const remaining = (used: unknown, flat: unknown): number | undefined => {
    const value = typeof used === 'number' ? 100 - used : flat;
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : undefined;
  };
  const reset = (iso: unknown, flat: unknown): number | undefined => {
    const n = typeof iso === 'string' ? Date.parse(iso) : flat;
    return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
  };
  const fiveHourRemainingPercent = remaining(five?.utilization, j.fiveHourRemainingPercent);
  const weeklyRemainingPercent = remaining(week?.utilization, j.weeklyRemainingPercent);
  if (fiveHourRemainingPercent === undefined && weeklyRemainingPercent === undefined) return { available: false, error: 'unsupported response' };
  return { available: true, fiveHourRemainingPercent, weeklyRemainingPercent,
    fiveHourResetAt: reset(five?.resets_at, j.fiveHourResetAt),
    weeklyResetAt: reset(week?.resets_at, j.weeklyResetAt ?? j.sevenDayResetAt),
    subscriptionType: typeof j.subscriptionType === 'string' ? j.subscriptionType : undefined };
}
