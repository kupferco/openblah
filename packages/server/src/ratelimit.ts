/** Fixed-window in-memory limiter, per key. Per instance: enough for a cheap ping. */
export class RateLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns 0 if allowed (and counts the hit), else the ms to wait. */
  check(key: string): number {
    const t = this.now();
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (t - v.start >= this.windowMs) this.hits.delete(k);
    }
    const h = this.hits.get(key);
    if (!h || t - h.start >= this.windowMs) {
      this.hits.set(key, { start: t, count: 1 });
      return 0;
    }
    if (h.count >= this.limit) return this.windowMs - (t - h.start);
    h.count++;
    return 0;
  }
}
