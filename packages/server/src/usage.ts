import type { Room, Storage } from "./types.js";

/**
 * Provider prices used for cost estimates, in GBP. These are estimates from the
 * providers' public price pages as of `asOf`; they are NOT read from a bill.
 * Override any field with `OPENBLAH_PRICES` (JSON). See `docs/costs.md`.
 */
export interface PriceTable {
  /** Date the defaults were last checked against the price pages (YYYY-MM-DD). */
  asOf: string;
  /** LiveKit Cloud WebRTC participant minute. */
  livekitPerParticipantMinute: number;
  /** Deepgram streaming STT, per second of audio sent. */
  sttPerSecond: number;
  /** Cartesia TTS, per character. */
  ttsPerCharacter: number;
  /** Gemini Flash, per million input tokens. */
  llmInputPerMillionTokens: number;
  /** Gemini Flash, per million output tokens. */
  llmOutputPerMillionTokens: number;
}

export const DEFAULT_PRICES: PriceTable = {
  asOf: "2026-11-17",
  livekitPerParticipantMinute: 0.0004,
  sttPerSecond: 0.0001,
  ttsPerCharacter: 0.00004,
  llmInputPerMillionTokens: 0.24,
  llmOutputPerMillionTokens: 2.0,
};

export type CostProvider = "livekit" | "stt" | "tts" | "llm";

export interface CostBreakdown {
  livekit: number;
  stt: number;
  tts: number;
  llm: number;
  total: number;
}

/** What the agent worker reports. Every field is a delta since the last report. */
export interface UsageReport {
  /** Seconds the agent listened, thought or spoke (the trial meter). */
  agentSeconds?: number;
  /** Wall-clock seconds of the agent session. */
  elapsedSeconds?: number;
  /** Seconds since anyone last spoke (current value, not a delta). */
  idleSeconds?: number;
  /** Seconds each participant (user id) was in the room. */
  participantSeconds?: Record<string, number>;
  /** Seconds of audio sent to STT, per audio track. */
  sttSeconds?: Record<string, number>;
  ttsCharacters?: number;
  llmInputTokens?: number;
  llmOutputTokens?: number;
}

export type StopReason = "max_duration" | "idle_timeout" | "host_cap" | "user_cap" | "cost_cap";

export interface RoomUsage {
  roomId: string;
  /** LiveKit participant-minutes. */
  participantMinutes: number;
  agentSeconds: number;
  elapsedSeconds: number;
  /** STT audio seconds per track, and the sum. */
  sttSecondsByTrack: Record<string, number>;
  sttSeconds: number;
  ttsCharacters: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  /** Estimated cost in GBP per provider. An estimate from the price table, not a bill. */
  estimatedCostGbp: CostBreakdown;
  pricesAsOf: string;
}

export interface UsageLimits {
  /** Hard cap on one room's agent session. 0 turns it off. */
  maxRoomSeconds: number;
  /** Stop after this long with nobody speaking. 0 turns it off. */
  idleTimeoutSeconds: number;
  /** Per participant per month, in minutes in a room with the agent. 0 = no cap. */
  userMonthlyMinutes: number;
  /** Per host per month, in minutes of agent audio. 0 = no cap. */
  hostMonthlyMinutes: number;
}

export const DEFAULT_LIMITS: UsageLimits = {
  maxRoomSeconds: 2 * 60 * 60,
  idleTimeoutSeconds: 5 * 60,
  userMonthlyMinutes: 0,
  hostMonthlyMinutes: 0,
};

export interface CostAlert {
  event: "cost_alert";
  level: "warning_80" | "hard_cap";
  month: string;
  hostedCostGbp: number;
  capGbp: number;
}

export interface UsageOptions {
  prices?: PriceTable;
  limits?: UsageLimits;
  /** Monthly hard cap on the hosted (trial and demo) keys, GBP. Default 50. */
  monthlyCapGbp?: number;
  /** Fraction of the cap that triggers the warning. Default 0.8. */
  warnFraction?: number;
  now?: () => Date;
  /** Receives each alert once per month. Default: a structured log line. */
  notify?: (alert: CostAlert) => Promise<void> | void;
}

const enc = encodeURIComponent;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);

/** Merge a partial JSON price override into the defaults. Throws on bad values. */
export function parsePrices(raw: string | undefined): PriceTable {
  if (!raw) return DEFAULT_PRICES;
  const data = JSON.parse(raw) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...DEFAULT_PRICES };
  for (const [k, v] of Object.entries(data)) {
    if (!(k in DEFAULT_PRICES)) throw new Error(`unknown price "${k}"`);
    if (k === "asOf" ? typeof v !== "string" : typeof v !== "number" || !(v >= 0))
      throw new Error(`price "${k}" is invalid`);
    out[k] = v;
  }
  return out as unknown as PriceTable;
}

/** Posts alerts to a webhook. Never throws: an alert must not break a call. */
export function webhookNotifier(
  url: string,
  fetchFn: typeof fetch = fetch,
): (a: CostAlert) => Promise<void> {
  return async (alert) => {
    try {
      await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(alert),
      });
    } catch {
      /* the structured log line is the record */
    }
  };
}

/**
 * Usage log, caps and the monthly provider-cost counter. Everything is kept in
 * the storage usage counters, so it survives restarts and is shared by instances.
 */
export class UsageService {
  readonly prices: PriceTable;
  readonly limits: UsageLimits;
  readonly monthlyCapGbp: number;
  private readonly warnFraction: number;
  private readonly now: () => Date;
  private readonly notify: (a: CostAlert) => Promise<void> | void;

  constructor(
    private readonly storage: Storage,
    opts: UsageOptions = {},
  ) {
    this.prices = opts.prices ?? DEFAULT_PRICES;
    this.limits = opts.limits ?? DEFAULT_LIMITS;
    this.monthlyCapGbp = opts.monthlyCapGbp ?? 50;
    this.warnFraction = opts.warnFraction ?? 0.8;
    this.now = opts.now ?? (() => new Date());
    this.notify = opts.notify ?? ((a) => console.log(JSON.stringify(a)));
  }

  month(): string {
    return this.now().toISOString().slice(0, 7);
  }

  private readonly roomKey = (roomId: string) => `room:${enc(roomId)}:`;

  cost(m: {
    participantSeconds: number;
    sttSeconds: number;
    ttsCharacters: number;
    llmInputTokens: number;
    llmOutputTokens: number;
  }): CostBreakdown {
    const p = this.prices;
    const livekit = (m.participantSeconds / 60) * p.livekitPerParticipantMinute;
    const stt = m.sttSeconds * p.sttPerSecond;
    const tts = m.ttsCharacters * p.ttsPerCharacter;
    const llm =
      (m.llmInputTokens / 1e6) * p.llmInputPerMillionTokens +
      (m.llmOutputTokens / 1e6) * p.llmOutputPerMillionTokens;
    return { livekit, stt, tts, llm, total: livekit + stt + tts + llm };
  }

  /** Cost of hosted (trial and demo) keys this month, GBP. */
  async hostedCostThisMonth(): Promise<number> {
    return this.storage.getUsage(`month:${this.month()}:hosted_cost`);
  }

  async hostedCapReached(): Promise<boolean> {
    return this.monthlyCapGbp > 0 && (await this.hostedCostThisMonth()) >= this.monthlyCapGbp;
  }

  async hostMinutesThisMonth(hostUserId: string): Promise<number> {
    return (await this.storage.getUsage(`month:${this.month()}:host:${enc(hostUserId)}`)) / 60;
  }

  async userMinutesThisMonth(userId: string): Promise<number> {
    return (await this.storage.getUsage(`month:${this.month()}:user:${enc(userId)}`)) / 60;
  }

  /** Check the monthly minute caps before an agent starts. Null when allowed. */
  async checkStart(room: Room, participantIds: readonly string[]): Promise<StopReason | null> {
    const { hostMonthlyMinutes, userMonthlyMinutes } = this.limits;
    if (
      hostMonthlyMinutes > 0 &&
      (await this.hostMinutesThisMonth(room.hostUserId)) >= hostMonthlyMinutes
    )
      return "host_cap";
    if (userMonthlyMinutes > 0) {
      for (const id of participantIds) {
        if ((await this.userMinutesThisMonth(id)) >= userMonthlyMinutes) return "user_cap";
      }
    }
    return null;
  }

  /** Room limits: the host may lower the server defaults, never raise them. */
  roomLimits(room: Room): { maxRoomSeconds: number; idleTimeoutSeconds: number } {
    const pick = (own: number | undefined, server: number) =>
      own && own > 0 ? (server > 0 ? Math.min(own, server) : own) : server;
    return {
      maxRoomSeconds: pick(room.maxDurationSeconds, this.limits.maxRoomSeconds),
      idleTimeoutSeconds: pick(room.idleTimeoutSeconds, this.limits.idleTimeoutSeconds),
    };
  }

  /**
   * Add a report to the room's usage log and the monthly counters, then say whether
   * the agent may go on. `hosted` is true when the trial (hosted) keys pay.
   */
  async record(
    room: Room,
    report: UsageReport,
    hosted: boolean,
  ): Promise<{ available: boolean; stop?: StopReason }> {
    const s = this.storage;
    const rk = this.roomKey(room.id);
    const month = this.month();
    const add = async (id: string, v: number) => (v > 0 ? s.addUsage(id, v) : undefined);

    const participantSeconds = Object.fromEntries(
      Object.entries(report.participantSeconds ?? {}).map(([k, v]) => [k, num(v)]),
    );
    const stt = Object.fromEntries(
      Object.entries(report.sttSeconds ?? {}).map(([k, v]) => [k, num(v)]),
    );
    const delta = {
      participantSeconds: sum(participantSeconds),
      sttSeconds: sum(stt),
      ttsCharacters: num(report.ttsCharacters),
      llmInputTokens: num(report.llmInputTokens),
      llmOutputTokens: num(report.llmOutputTokens),
    };

    await add(`${rk}lk`, delta.participantSeconds);
    await add(`${rk}agent`, num(report.agentSeconds));
    await add(`${rk}elapsed`, num(report.elapsedSeconds));
    for (const [track, v] of Object.entries(stt)) await add(`${rk}stt:${enc(track)}`, v);
    await add(`${rk}tts`, delta.ttsCharacters);
    await add(`${rk}llmin`, delta.llmInputTokens);
    await add(`${rk}llmout`, delta.llmOutputTokens);

    for (const [user, v] of Object.entries(participantSeconds))
      await add(`month:${month}:user:${enc(user)}`, v);
    await add(`month:${month}:host:${enc(room.hostUserId)}`, num(report.agentSeconds));

    const c = this.cost(delta);
    await add(`month:${month}:cost`, c.total);
    let hostedCost = 0;
    if (hosted) {
      await add(`month:${month}:hosted_cost`, c.total);
      hostedCost = await s.getUsage(`month:${month}:hosted_cost`);
      await this.alerts(month, hostedCost);
    }

    const limits = this.roomLimits(room);
    let stop: StopReason | undefined;
    if (limits.maxRoomSeconds > 0 && (await s.getUsage(`${rk}elapsed`)) >= limits.maxRoomSeconds)
      stop = "max_duration";
    else if (limits.idleTimeoutSeconds > 0 && num(report.idleSeconds) >= limits.idleTimeoutSeconds)
      stop = "idle_timeout";
    else if (
      this.limits.hostMonthlyMinutes > 0 &&
      (await this.hostMinutesThisMonth(room.hostUserId)) >= this.limits.hostMonthlyMinutes
    )
      stop = "host_cap";
    else if (this.limits.userMonthlyMinutes > 0) {
      for (const user of Object.keys(participantSeconds)) {
        if ((await this.userMinutesThisMonth(user)) >= this.limits.userMonthlyMinutes) {
          stop = "user_cap";
          break;
        }
      }
    }
    if (!stop && hosted && this.monthlyCapGbp > 0 && hostedCost >= this.monthlyCapGbp)
      stop = "cost_cap";
    return stop ? { available: false, stop } : { available: true };
  }

  /** Fire each alert once per month: addUsage on a flag is atomic, only the first caller sees 1. */
  private async alerts(month: string, hostedCost: number): Promise<void> {
    const cap = this.monthlyCapGbp;
    if (cap <= 0) return;
    const fire = async (level: CostAlert["level"], flag: string) => {
      if ((await this.storage.addUsage(`month:${month}:${flag}`, 1)) !== 1) return;
      try {
        await this.notify({
          event: "cost_alert",
          level,
          month,
          hostedCostGbp: Math.round(hostedCost * 100) / 100,
          capGbp: cap,
        });
      } catch {
        /* alerting must not break a call */
      }
    };
    if (hostedCost >= cap * this.warnFraction) await fire("warning_80", "alert80");
    if (hostedCost >= cap) await fire("hard_cap", "alert100");
  }

  async roomUsage(roomId: string): Promise<RoomUsage> {
    const all = await this.storage.listUsage(this.roomKey(roomId));
    const p = this.roomKey(roomId);
    const get = (k: string) => all[`${p}${k}`] ?? 0;
    const sttSecondsByTrack: Record<string, number> = {};
    for (const [id, v] of Object.entries(all)) {
      if (id.startsWith(`${p}stt:`))
        sttSecondsByTrack[decodeURIComponent(id.slice(p.length + 4))] = v;
    }
    const m = {
      participantSeconds: get("lk"),
      sttSeconds: sum(sttSecondsByTrack),
      ttsCharacters: get("tts"),
      llmInputTokens: get("llmin"),
      llmOutputTokens: get("llmout"),
    };
    return {
      roomId,
      participantMinutes: m.participantSeconds / 60,
      agentSeconds: get("agent"),
      elapsedSeconds: get("elapsed"),
      sttSecondsByTrack,
      sttSeconds: m.sttSeconds,
      ttsCharacters: m.ttsCharacters,
      llmInputTokens: m.llmInputTokens,
      llmOutputTokens: m.llmOutputTokens,
      estimatedCostGbp: this.cost(m),
      pricesAsOf: this.prices.asOf,
    };
  }
}
