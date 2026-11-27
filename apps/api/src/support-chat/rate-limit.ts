/**
 * Sliding-window counters kept in this process (T-175). The help chat stores no conversation, so its
 * limits live in memory: per conversation and per client address on the site, per person in the app.
 * Several API tasks each keep their own; the limit is a guard against abuse, not a quota.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one use of `key` and says whether it is within the limit. */
  allow(key: string): boolean {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    // Forget idle keys now and then so the map cannot grow without bound.
    if (this.hits.size > 10_000) for (const [other, times] of this.hits) if (times.every((at) => now - at >= this.windowMs)) this.hits.delete(other);
    return true;
  }
}
