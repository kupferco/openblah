type Env = Record<string, string | undefined>;

export interface RoomKeys {
  mode: "product" | "byok" | "trial";
  tier: "free" | "paid";
  keys: { gemini: string; deepgram: string; cartesia: string };
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
 * Ask the OpenBlah server for the current access token of a person's saved MCP
 * connection (it refreshes the token when needed). The token is used for the
 * MCP request and never logged, spoken or put in the room.
 */
export async function fetchMcpToken(
  roomId: string,
  ownerId: string,
  connectionId: string,
  refresh = false,
  env: Env = process.env,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const base = env.OPENBLAH_SERVER_URL;
  const secret = env.OPENBLAH_AGENT_SECRET;
  if (!base || !secret) throw new Error("MCP token lookup needs OPENBLAH_SERVER_URL");
  const res = await fetchFn(
    `${base.replace(/\/$/, "")}/internal/rooms/${encodeURIComponent(roomId)}/mcp-token`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId, connectionId, ...(refresh ? { refresh: true } : {}) }),
    },
  );
  if (!res.ok) throw new Error(`MCP token lookup refused (${res.status})`);
  return ((await res.json()) as { accessToken: string }).accessToken;
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

/** The usage log fields the server accepts (see `UsageReport` in @openblah/server). */
export interface UsageDelta {
  agentSeconds: number;
  elapsedSeconds: number;
  /** Seconds since anyone last spoke (a current value, not a delta). */
  idleSeconds: number;
  participantSeconds: Record<string, number>;
  sttSeconds: Record<string, number>;
  ttsCharacters: number;
  llmInputTokens: number;
  llmOutputTokens: number;
}

/** The subset of the SDK's metrics events the collector reads. */
export type MetricsLike =
  | { type: "stt_metrics"; audioDurationMs: number }
  | { type: "tts_metrics"; charactersCount: number }
  | { type: "llm_metrics"; promptTokens: number; completionTokens: number }
  | { type: string };

/**
 * Collects the usage log between reports: participant time, STT audio seconds per
 * track, TTS characters, LLM tokens, wall clock and idle time. `take()` returns the
 * deltas since the last call. The server prices them and enforces the caps.
 */
export class UsageCollector {
  private readonly present = new Map<string, number>();
  private readonly participantMs = new Map<string, number>();
  private stt = new Map<string, number>();
  private tts = 0;
  private llmIn = 0;
  private llmOut = 0;
  private lastTake: number;
  private lastActivity: number;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly meter: UsageMeter = new UsageMeter(now),
  ) {
    this.lastTake = this.lastActivity = now();
  }

  participantJoined(id: string): void {
    if (!this.present.has(id)) this.present.set(id, this.now());
  }

  participantLeft(id: string): void {
    const since = this.present.get(id);
    if (since === undefined) return;
    this.participantMs.set(id, (this.participantMs.get(id) ?? 0) + (this.now() - since));
    this.present.delete(id);
  }

  /** Call whenever someone speaks or the agent speaks; resets the idle clock. */
  activity(): void {
    this.lastActivity = this.now();
  }

  agentState(state: string): void {
    this.meter.setState(state);
    if (state === "speaking" || state === "thinking") this.activity();
  }

  metrics(m: MetricsLike, track = "session"): void {
    if (m.type === "stt_metrics") {
      const ms = (m as { audioDurationMs: number }).audioDurationMs;
      this.stt.set(track, (this.stt.get(track) ?? 0) + ms / 1000);
    } else if (m.type === "tts_metrics") {
      this.tts += (m as { charactersCount: number }).charactersCount;
    } else if (m.type === "llm_metrics") {
      const l = m as { promptTokens: number; completionTokens: number };
      this.llmIn += l.promptTokens;
      this.llmOut += l.completionTokens;
    }
  }

  take(): UsageDelta {
    const t = this.now();
    for (const [id, since] of this.present) {
      this.participantMs.set(id, (this.participantMs.get(id) ?? 0) + (t - since));
      this.present.set(id, t);
    }
    const out: UsageDelta = {
      agentSeconds: this.meter.take(),
      elapsedSeconds: (t - this.lastTake) / 1000,
      idleSeconds: (t - this.lastActivity) / 1000,
      participantSeconds: Object.fromEntries(
        [...this.participantMs].map(([k, v]) => [k, v / 1000]),
      ),
      sttSeconds: Object.fromEntries(this.stt),
      ttsCharacters: this.tts,
      llmInputTokens: this.llmIn,
      llmOutputTokens: this.llmOut,
    };
    this.lastTake = t;
    this.participantMs.clear();
    this.stt = new Map();
    this.tts = this.llmIn = this.llmOut = 0;
    return out;
  }
}

/**
 * Send a usage log delta. Returns `available: false` with the server's reason when
 * the agent must stop (room limit, monthly cap, cost cap, trial used up).
 */
export async function reportUsageLog(
  roomId: string,
  delta: UsageDelta,
  env: Env = process.env,
  fetchFn: typeof fetch = fetch,
): Promise<{ available: boolean; stop?: string }> {
  const base = env.OPENBLAH_SERVER_URL;
  const secret = env.OPENBLAH_AGENT_SECRET;
  if (!base || !secret) return { available: true };
  const res = await fetchFn(
    `${base.replace(/\/$/, "")}/internal/rooms/${encodeURIComponent(roomId)}/usage`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...delta, seconds: Math.min(3600, Math.max(0, delta.agentSeconds)) }),
    },
  );
  if (!res.ok) return { available: true };
  const data = (await res.json()) as { available?: boolean; stop?: string };
  return data.available === false
    ? { available: false, ...(data.stop ? { stop: data.stop } : {}) }
    : { available: true };
}
