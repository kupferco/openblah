/** Options for {@link warmup}. */
export interface WarmupOptions {
  /** Base URL of the OpenBlah server, e.g. `https://api.example.com`. */
  serverUrl: string;
  /** Key for `/v1` calls. Your own backend should proxy this if the key must stay secret. */
  apiKey: string;
  /** The signed-in user; warm-up is rate limited per user. */
  userId: string;
  /** Mainly for tests. */
  fetch?: typeof fetch;
}

/** `warming`: worker start requested. `warm`: asked very recently. `unavailable`: no worker configured or reachable. `limited`: rate limited. */
export type WarmupStatus = "warming" | "warm" | "unavailable" | "limited";

/**
 * Ask the server to start the agent worker (it scales to zero) so it is ready
 * when the user taps to talk. Cheap and idempotent; never throws. A failed
 * warm-up only means the agent may take a few seconds longer to join.
 */
export async function warmup(options: WarmupOptions): Promise<WarmupStatus> {
  const f = options.fetch ?? fetch;
  try {
    const res = await f(`${options.serverUrl.replace(/\/+$/, "")}/v1/warmup`, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ userId: options.userId }),
    });
    if (res.status === 429) return "limited";
    if (!res.ok) return "unavailable";
    const body = (await res.json()) as { status?: string };
    return body.status === "warming" || body.status === "warm" ? body.status : "unavailable";
  } catch {
    return "unavailable";
  }
}

/** The part of `document` used here (React Native has none). */
export interface VisibilityDocument {
  visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/**
 * Warm up now (the client opened) and again whenever the page becomes visible.
 * Returns a function that stops listening. Outside a browser it warms up once.
 */
export function startWarmup(options: WarmupOptions, doc?: VisibilityDocument): () => void {
  void warmup(options);
  const d = doc ?? (globalThis as { document?: VisibilityDocument }).document;
  if (!d) return () => undefined;
  const onVisible = () => {
    if (d.visibilityState === "visible") void warmup(options);
  };
  d.addEventListener("visibilitychange", onVisible);
  return () => d.removeEventListener("visibilitychange", onVisible);
}
