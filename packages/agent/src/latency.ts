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

/** Logged once when a job starts: how long the worker took from process start to ready for this call. */
export interface ColdStartLog {
  event: "cold_start";
  roomId?: string;
  /** Process start to the job being picked up. Large on a cold instance, near the job's own time when warm. */
  processUptimeMs: number;
  /** Job entry to the agent session running (models, keys, tools, room join). */
  sessionReadyMs: number;
  /** True when this was the first job this process has run: the instance was cold. */
  firstJob: boolean;
  ts: string;
}

let jobsStarted = 0;

export function buildColdStartLog(args: {
  roomId?: string;
  entryAt: number;
  readyAt: number;
  uptimeSeconds?: number;
  now?: Date;
}): ColdStartLog {
  jobsStarted += 1;
  return {
    event: "cold_start",
    ...(args.roomId ? { roomId: args.roomId } : {}),
    processUptimeMs: Math.round((args.uptimeSeconds ?? process.uptime()) * 1000),
    sessionReadyMs: Math.max(0, Math.round(args.readyAt - args.entryAt)),
    firstJob: jobsStarted === 1,
    ts: (args.now ?? new Date()).toISOString(),
  };
}

/** One tool call and how long it took. */
export interface ToolCallLog {
  event: "tool_call";
  roomId?: string;
  tool: string;
  durationMs: number;
  ok: boolean;
  ts: string;
}

type Executable = { execute?: (...args: never[]) => unknown };

/**
 * Time every tool call in the structured log. Wraps `execute` in place, so the tools keep their
 * identity (LiveKit brands them). Only the name and duration are logged, never arguments or results.
 */
export function timeTools<T extends Record<string, unknown>>(
  tools: T,
  roomId?: string,
  log: (entry: object) => void = writeLog,
  clock: () => number = () => performance.now(),
  sessionId?: string,
): T {
  for (const [name, tool] of Object.entries(tools)) {
    const t = tool as Executable;
    const original = t.execute;
    if (typeof original !== "function") continue;
    t.execute = (async (...args: never[]) => {
      const start = clock();
      let ok = true;
      let failure: { err: string; stack?: string } | undefined;
      // The start line is what shows a tool that never came back.
      log({
        event: "tool_start",
        ...(roomId ? { roomId } : {}),
        ...(sessionId ? { sessionId } : {}),
        tool: name,
        ts: new Date().toISOString(),
      });
      try {
        return await original.apply(tool, args);
      } catch (err) {
        ok = false;
        failure =
          err instanceof Error
            ? { err: `${err.name}: ${err.message}`, ...(err.stack ? { stack: err.stack } : {}) }
            : { err: String(err) };
        throw err;
      } finally {
        log({
          event: "tool_call",
          ...(roomId ? { roomId } : {}),
          ...(sessionId ? { sessionId } : {}),
          ...failure,
          tool: name,
          durationMs: Math.round(clock() - start),
          ok,
          ts: new Date().toISOString(),
        } satisfies ToolCallLog);
      }
    }) as never;
  }
  return tools;
}
