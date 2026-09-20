import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * How much of Claude's window is left, and what that should change.
 *
 * Claude Code keeps its own usage in ~/.claude/usage-cache.json and refreshes it as it works, so the number is
 * read rather than guessed or counted locally. Two thresholds decide the gear:
 *
 *   plenty  (>= saver + a margin)  the best model, whatever that costs
 *   normal                          the everyday model
 *   saver   (<= saverBelow)         hand the work to another provider instead of spending the rest
 *
 * Pulkit, 20 Sep 2026: "keep some to orchestrate codex instead if its less than 30, more than 70 uses fable".
 */
export type Gear = 'plenty' | 'normal' | 'saver' | 'unknown';

export interface QuotaThresholds {
  /** At or above this much left, use the best model. */
  bestAbove: number;
  /** At or below this much left, stop spending it and delegate. */
  saverBelow: number;
  bestModel: string;
  normalModel: string;
}

export const DEFAULT_THRESHOLDS: QuotaThresholds = {
  bestAbove: 70, saverBelow: 30, bestModel: 'fable', normalModel: 'sonnet'
};

export interface Quota {
  /** Percent of the window still available, lowest of the windows that matter. */
  remaining?: number;
  fiveHour?: number;
  sevenDay?: number;
  resetsAt?: number;
  /** Minutes since Claude last refreshed the figure. */
  ageMinutes?: number;
  error?: string;
}

const CACHE = join(homedir(), '.claude', 'usage-cache.json');

export function readQuota(path = CACHE): Quota {
  let raw: string;
  try { raw = readFileSync(path, 'utf-8'); }
  catch { return { error: 'no usage cache yet; run Claude Code once so it writes one' }; }
  try {
    const j = JSON.parse(raw) as {
      fetchedAt?: number;
      data?: { five_hour?: { utilization?: number; resets_at?: string }; seven_day?: { utilization?: number; resets_at?: string } };
    };
    const five = j.data?.five_hour, week = j.data?.seven_day;
    const left = (u?: number) => (typeof u === 'number' ? Math.max(0, 100 - u) : undefined);
    const fiveHour = left(five?.utilization), sevenDay = left(week?.utilization);
    const both = [fiveHour, sevenDay].filter((n): n is number => typeof n === 'number');
    // the window that runs out first is the one that decides
    const tightest = both.length ? Math.min(...both) : undefined;
    const resets = (fiveHour ?? 100) <= (sevenDay ?? 100) ? five?.resets_at : week?.resets_at;
    return {
      remaining: tightest, fiveHour, sevenDay,
      resetsAt: resets ? Date.parse(resets) : undefined,
      ageMinutes: j.fetchedAt ? (Date.now() - j.fetchedAt) / 60000 : undefined
    };
  } catch { return { error: 'the usage cache is not readable JSON' }; }
}

export function gearFor(q: Quota, t: QuotaThresholds = DEFAULT_THRESHOLDS): Gear {
  if (typeof q.remaining !== 'number') return 'unknown';
  if (q.remaining <= t.saverBelow) return 'saver';
  if (q.remaining >= t.bestAbove) return 'plenty';
  return 'normal';
}

/** The worker and model this gear implies. In saver the work goes elsewhere while the window refills. */
export function planFor(gear: Gear, t: QuotaThresholds = DEFAULT_THRESHOLDS): { worker: 'claude' | 'codex'; model?: string } {
  if (gear === 'saver') return { worker: 'codex' };
  if (gear === 'plenty') return { worker: 'claude', model: t.bestModel };
  return { worker: 'claude', model: t.normalModel };
}

export function describe(q: Quota, t: QuotaThresholds = DEFAULT_THRESHOLDS): string {
  if (q.error) return `Claude usage unknown: ${q.error}`;
  const gear = gearFor(q, t);
  const plan = planFor(gear, t);
  const back = q.resetsAt ? new Date(q.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'unknown';
  const stale = (q.ageMinutes ?? 0) > 30 ? ` (figure is ${Math.round(q.ageMinutes!)} min old)` : '';
  const where = plan.worker === 'codex' ? 'codex, to save the rest' : `claude (${plan.model})`;
  return `Claude ${q.remaining}% left (5h ${q.fiveHour ?? '?'}%, 7d ${q.sevenDay ?? '?'}%), resets ${back}${stale}. `
       + `Gear: ${gear} → ${where}.`;
}
