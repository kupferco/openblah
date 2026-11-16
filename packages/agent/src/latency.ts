/** One structured log line per turn. */
export interface TurnLatencyLog {
  event: "turn_latency";
  roomId?: string;
  turn: number;
  /** End of the person's speech to the first agent audio, in ms. */
  endOfSpeechToFirstAudioMs: number | null;
  /** Share of that time spent in each stage, when LiveKit reports them. */
  endOfTurnDelayMs: number | null;
  transcriptionDelayMs: number | null;
  llmFirstTokenMs: number | null;
  ttsFirstByteMs: number | null;
  interrupted: boolean;
  language: string;
  ts: string;
}

/** Subset of LiveKit's per-turn metrics report (seconds). */
export interface TurnMetrics {
  e2eLatency?: number;
  endOfTurnDelay?: number;
  transcriptionDelay?: number;
  llmNodeTtft?: number;
  ttsNodeTtfb?: number;
}

const ms = (s: number | undefined): number | null =>
  typeof s === "number" && Number.isFinite(s) ? Math.round(s * 1000) : null;

export function buildTurnLatencyLog(args: {
  roomId?: string;
  turn: number;
  metrics: TurnMetrics | undefined;
  interrupted: boolean;
  language: string;
  now?: Date;
}): TurnLatencyLog {
  const m = args.metrics ?? {};
  return {
    event: "turn_latency",
    ...(args.roomId ? { roomId: args.roomId } : {}),
    turn: args.turn,
    endOfSpeechToFirstAudioMs: ms(m.e2eLatency),
    endOfTurnDelayMs: ms(m.endOfTurnDelay),
    transcriptionDelayMs: ms(m.transcriptionDelay),
    llmFirstTokenMs: ms(m.llmNodeTtft),
    ttsFirstByteMs: ms(m.ttsNodeTtfb),
    interrupted: args.interrupted,
    language: args.language,
    ts: (args.now ?? new Date()).toISOString(),
  };
}

/** Write a structured log as one JSON line on stdout. */
export function writeLog(entry: object, out: (line: string) => void = console.log): void {
  out(JSON.stringify(entry));
}
