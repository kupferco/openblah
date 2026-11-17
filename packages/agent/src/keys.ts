import type { RoomVendorKeys } from "./providers/index.js";

type Env = Record<string, string | undefined>;

export interface RoomKeys {
  mode: "product" | "byok" | "trial";
  tier: "free" | "paid";
  keys: RoomVendorKeys;
}

/**
 * Ask the OpenBlah server whose keys pay for this room (host BYOK, product key
 * or trial). Returns null when the worker is not wired to a server, so it keeps
 * using its own environment keys (plain self-hosted use).
 */
export async function fetchRoomKeys(
  roomId: string,
  env: Env = process.env,
  fetchFn: typeof fetch = fetch,
): Promise<RoomKeys | null> {
  const base = env.OPENBLAH_SERVER_URL;
  const secret = env.OPENBLAH_AGENT_SECRET;
  if (!base || !secret) return null;
  const res = await fetchFn(
    `${base.replace(/\/$/, "")}/internal/rooms/${encodeURIComponent(roomId)}/provider-keys`,
    { method: "POST", headers: { Authorization: `Bearer ${secret}` } },
  );
  if (!res.ok) throw new Error(`key lookup refused (${res.status})`);
  return (await res.json()) as RoomKeys;
}

/**
 * Counts the seconds the agent listens, thinks or speaks and reports them to
 * the server, which does the trial accounting. `onExhausted` fires when the
 * server says the trial is used up.
 */
export class UsageMeter {
  private since: number | null = null;
  private pending = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Feed agent states; "idle", "initializing" and the like do not count. */
  setState(state: string): void {
    const active = state === "listening" || state === "thinking" || state === "speaking";
    const t = this.now();
    if (this.since !== null) this.pending += (t - this.since) / 1000;
    this.since = active ? t : null;
  }

  /** Seconds accumulated since the last take. */
  take(): number {
    const t = this.now();
    if (this.since !== null) {
      this.pending += (t - this.since) / 1000;
      this.since = t;
    }
    const s = Math.round(this.pending);
    this.pending -= s;
    return s;
  }
}

/** Report seconds to the server. Returns false when the trial is exhausted. */
export async function reportUsage(
  roomId: string,
  seconds: number,
  env: Env = process.env,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  const base = env.OPENBLAH_SERVER_URL;
  const secret = env.OPENBLAH_AGENT_SECRET;
  if (!base || !secret || seconds <= 0) return true;
  const res = await fetchFn(
    `${base.replace(/\/$/, "")}/internal/rooms/${encodeURIComponent(roomId)}/usage`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ seconds }),
    },
  );
  if (!res.ok) return true;
  const data = (await res.json()) as { counted?: boolean; available?: boolean };
  return !(data.counted && data.available === false);
}
