import type { WorkerWaker } from "./types.js";

const METADATA_IDENTITY =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";

/**
 * Wakes the agent worker Cloud Run service with a plain GET to its HTTP port
 * (the LiveKit Agents worker serves a health response there). The request makes
 * Cloud Run start an instance; the worker then registers with LiveKit and waits
 * for jobs. With `iam` the worker service is private and we send a Google ID
 * token fetched from the metadata server (no extra dependency).
 */
export class HttpWorkerWaker implements WorkerWaker {
  constructor(
    private readonly url: string,
    private readonly iam = false,
    private readonly timeoutMs = 10_000,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly pollMs = 1_000,
  ) {}

  /** The ID token header for a private (`iam`) worker; empty when it is public. */
  private async headers(): Promise<Record<string, string> | null> {
    if (!this.iam) return {};
    const r = await this.fetchFn(`${METADATA_IDENTITY}?audience=${encodeURIComponent(this.url)}`, {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!r.ok) return null;
    return { Authorization: `Bearer ${await r.text()}` };
  }

  async wake(): Promise<boolean> {
    try {
      const headers = await this.headers();
      if (!headers) return false;
      const res = await this.fetchFn(this.url, {
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return res.ok;
    } catch {
      // Never log the URL or headers.
      console.error("worker wake failed");
      return false;
    }
  }

  /**
   * Polls the worker's `/ready` until it says it is registered with LiveKit. An older worker
   * without `/ready` answers it like any path, with 200, so this returns at once as before.
   */
  async ready(timeoutMs: number): Promise<boolean> {
    const until = Date.now() + timeoutMs;
    const readyUrl = `${this.url.replace(/\/+$/, "")}/ready`;
    while (Date.now() < until) {
      try {
        const headers = await this.headers();
        if (headers) {
          const res = await this.fetchFn(readyUrl, {
            headers,
            signal: AbortSignal.timeout(this.timeoutMs),
          });
          if (res.ok) return true;
        }
      } catch {
        // Starting up: not answering yet is the same as not ready.
      }
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
    console.error("worker not ready in time");
    return false;
  }
}

export class NoopWaker implements WorkerWaker {
  async wake(): Promise<boolean> {
    return false;
  }
}
