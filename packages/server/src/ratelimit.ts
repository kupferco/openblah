/** Fixed-window in-memory limiter. Per instance, which is fine as a brake on guessing. */
export class RateLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true when the call is allowed. */
  allow(key: string, nowMs: number): boolean {
    if (this.hits.size > 10_000) this.sweep(nowMs);
    const h = this.hits.get(key);
    if (!h || nowMs - h.start >= this.windowMs) {
      this.hits.set(key, { start: nowMs, count: 1 });
      return true;
    }
    h.count += 1;
    return h.count <= this.max;
  }

  private sweep(nowMs: number): void {
    for (const [k, h] of this.hits) if (nowMs - h.start >= this.windowMs) this.hits.delete(k);
  }
}
