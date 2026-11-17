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
  ) {}

  async wake(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};
      if (this.iam) {
        const r = await this.fetchFn(
          `${METADATA_IDENTITY}?audience=${encodeURIComponent(this.url)}`,
          {
            headers: { "Metadata-Flavor": "Google" },
            signal: AbortSignal.timeout(this.timeoutMs),
          },
        );
        if (!r.ok) return false;
        headers.Authorization = `Bearer ${await r.text()}`;
      }
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
}

export class NoopWaker implements WorkerWaker {
  async wake(): Promise<boolean> {
    return false;
  }
}
