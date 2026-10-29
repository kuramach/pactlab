/**
 * Posture signals (T-091 Part 1): the enforcement climate as dated, cited
 * entries. The summary counts what the evidence says; it never sets
 * Foresight's forecast or the clearance band — people read it and decide.
 */
export type PostureDirection = 'TIGHTENING' | 'HOLDING' | 'LOOSENING';

export interface PostureSignal {
  readonly id: string;
  readonly date: string;
  readonly authority: string;
  readonly scope: 'GUIDELINES' | 'COMPARABLE_CASE' | 'SECTOR_SIGNAL';
  readonly direction: PostureDirection;
  readonly signal: string;
}

export interface PostureSummary {
  readonly signals: number;
  readonly tightening: number;
  readonly holding: number;
  readonly loosening: number;
  /** Date of the most recent signal. */
  readonly latest: string | null;
  /** The direction most signals point, or MIXED when no direction leads; null without signals. */
  readonly lean: PostureDirection | 'MIXED' | null;
}

/** Newest first; ties by authority, then id, so the order is stable. */
export function orderPosture<T extends PostureSignal>(signals: readonly T[]): T[] {
  return [...signals].sort((a, b) => b.date.localeCompare(a.date) || a.authority.localeCompare(b.authority) || a.id.localeCompare(b.id));
}

export function summarizePosture(signals: readonly PostureSignal[]): PostureSummary {
  const count = (direction: PostureDirection) => signals.filter((signal) => signal.direction === direction).length;
  const counts = { TIGHTENING: count('TIGHTENING'), HOLDING: count('HOLDING'), LOOSENING: count('LOOSENING') } as const;
  const top = Math.max(...Object.values(counts));
  const leaders = (Object.keys(counts) as PostureDirection[]).filter((direction) => counts[direction] === top);
  return {
    signals: signals.length,
    tightening: counts.TIGHTENING,
    holding: counts.HOLDING,
    loosening: counts.LOOSENING,
    latest: orderPosture(signals)[0]?.date ?? null,
    lean: signals.length === 0 ? null : leaders.length === 1 ? (leaders[0] as PostureDirection) : 'MIXED',
  };
}
