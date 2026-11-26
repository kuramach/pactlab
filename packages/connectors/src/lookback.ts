import { z } from 'zod';

/** Engineering history older than this describes people who have often left (T-169). */
export const DEFAULT_LOOKBACK_MONTHS = 24;
/** The longest bounded window a connection may choose; beyond it, choose all history. */
export const MAX_LOOKBACK_MONTHS = 240;
export const ALL_HISTORY = 'ALL' as const;

/** Months of history to read, or `ALL`. Unset means the 24-month default, never all history. */
export const lookbackMonthsSchema = z.union([z.number().int().min(1).max(MAX_LOOKBACK_MONTHS), z.literal(ALL_HISTORY)]);
export type LookbackMonths = z.infer<typeof lookbackMonthsSchema>;

export const lookbackOf = (configured: LookbackMonths | undefined): LookbackMonths => configured ?? DEFAULT_LOOKBACK_MONTHS;

/** The first instant inside the window (UTC calendar-month arithmetic), or null for all history. Computed at sync time. */
export function lookbackStart(configured: LookbackMonths | undefined, now: Date = new Date()): Date | null {
  const months = lookbackOf(configured);
  if (months === ALL_HISTORY) return null;
  const start = new Date(now.getTime());
  start.setUTCMonth(start.getUTCMonth() - months);
  return start;
}

/** True when an ISO timestamp is inside the window (always true for all history). */
export function withinLookback(iso: string, start: Date | null): boolean {
  return start === null || new Date(iso).getTime() >= start.getTime();
}

/** What a reviewer reads: "last 24 months" or "all history". */
export function describeLookback(configured: LookbackMonths | undefined): string {
  const months = lookbackOf(configured);
  return months === ALL_HISTORY ? 'all history' : `last ${months} months`;
}
