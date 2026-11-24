import { writeLog } from "./latency.js";

/**
 * Cloud Run counts only HTTP requests as activity. A call is an outbound connection to LiveKit,
 * so with min instances 0 an instance in the middle of a call looks idle and can be scaled down.
 * While a job runs, the worker therefore keeps one long request open to its own `/hold` route
 * (through the service URL, so the platform sees it). It ends when the job ends.
 *
 * Needs `WORKER_SELF_URL` (the service URL, set by the deploy) and the worker's service account
 * allowed to invoke the service. Without the URL (local runs, tests) it does nothing.
 */
export interface KeepAliveOptions {
  url: string | undefined;
  roomId?: string;
  fetchImpl?: typeof fetch;
  getToken?: (audience: string) => Promise<string | undefined>;
  /** Wait before reopening a request that ended while the job is still running. */
  retryMs?: number;
}

/** ID token for calling the service itself, from the Cloud Run metadata server. */
export async function metadataIdToken(audience: string): Promise<string | undefined> {
  try {
    const res = await fetch(
      `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`,
      { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(2_000) },
    );
    return res.ok ? (await res.text()).trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Start holding the instance up. Returns a function that releases it. */
export function holdInstance(opts: KeepAliveOptions): () => void {
  const base = opts.url?.replace(/\/$/, "");
  if (!base) return () => {};
  const doFetch = opts.fetchImpl ?? fetch;
  const getToken = opts.getToken ?? metadataIdToken;
  const controller = new AbortController();
  let released = false;
  const loop = async () => {
    while (!released) {
      try {
        const token = await getToken(base);
        const res = await doFetch(`${base}/hold`, {
          signal: controller.signal,
          headers: token ? { authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          writeLog({ event: "keepalive_rejected", roomId: opts.roomId, status: res.status });
        } else {
          // Read until the server ends the request (Cloud Run's timeout) or we are released.
          await res.arrayBuffer();
        }
      } catch (err) {
        if (released) return;
        writeLog({ event: "keepalive_failed", roomId: opts.roomId, err: String(err) });
      }
      if (!released) await new Promise((r) => setTimeout(r, opts.retryMs ?? 5_000));
    }
  };
  void loop();
  return () => {
    released = true;
    controller.abort();
  };
}
