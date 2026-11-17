/** Fixed-window in-memory limiter. Per instance, which is fine as a brake on guessing. */
export class RateLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Returns true when the call is allowed. */
  allow(key: string, nowMs: number = this.clock()): boolean {
    if (this.hits.size > 10_000) this.sweep(nowMs);
    const h = this.hits.get(key);
    if (!h || nowMs - h.start >= this.windowMs) {
      this.hits.set(key, { start: nowMs, count: 1 });
      return true;
    }
    h.count += 1;
    return h.count <= this.max;
  }

  /** Returns 0 if allowed (and counts the hit), else the ms to wait. */
  check(key: string): number {
    const t = this.clock();
    if (this.allow(key, t)) return 0;
    const h = this.hits.get(key);
    return h ? Math.max(1, this.windowMs - (t - h.start)) : 0;
  }

  private sweep(nowMs: number): void {
    for (const [k, h] of this.hits) if (nowMs - h.start >= this.windowMs) this.hits.delete(k);
  }
}
