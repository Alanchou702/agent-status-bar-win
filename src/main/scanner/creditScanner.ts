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

function pickNumber(...vals: (number | undefined | null)[]): number | undefined {
  for (const v of vals) if (typeof v === 'number') return v;
  return undefined;
}

/** Fetch Claude usage/credit info. Resolves to a degraded snapshot on any failure. */
export async function scanClaudeCredits(config: CreditConfig): Promise<CreditSnapshot> {
  if (!config.enabled) return { available: false, error: 'disabled' };

  const token = readAccessToken(config.credentialsPath);
  if (!token) return { available: false, error: 'no credentials' };

  try {
    const res = await fetch(config.endpoint, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { available: false, error: `HTTP ${res.status}` };

    const j = (await res.json()) as Record<string, unknown>;
    return {
      available: true,
      fiveHourRemainingPercent: pickNumber(j.fiveHourRemainingPercent as number),
      fiveHourResetAt: pickNumber(j.fiveHourResetAt as number),
      weeklyRemainingPercent: pickNumber(j.weeklyRemainingPercent as number),
      weeklyResetAt: pickNumber(j.weeklyResetAt as number, j.sevenDayResetAt as number),
      subscriptionType: typeof j.subscriptionType === 'string' ? j.subscriptionType : undefined,
    };
  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : String(e) };
  }
}
