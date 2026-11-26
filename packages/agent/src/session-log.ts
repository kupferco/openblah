import { voice } from "@livekit/agents";
import { writeLog } from "./latency.js";

type Log = (entry: object) => void;

/** Fields on every line below, so one room and one job can be followed across restarts. */
export interface LogKey {
  roomId?: string;
  /** The LiveKit job id: a restart in the same room is a new job, so a new session. */
  sessionId?: string;
}

const errText = (err: unknown): { err: string; stack?: string } =>
  err instanceof Error
    ? { err: `${err.name}: ${err.message}`, ...(err.stack ? { stack: err.stack } : {}) }
    : { err: String(err) };

/**
 * Structured lines for what happens inside a session, keyed by room and session: user and agent
 * state changes (a stall shows as a state that never changes), user turns, LLM / TTS / STT errors
 * with stack, tool calls, interruptions, and the close reason. Only lengths are logged, never
 * what people said.
 */
export function attachSessionLogging(
  session: voice.AgentSession,
  key: LogKey,
  log: Log = writeLog,
  now: () => number = () => Date.now(),
): void {
  const line = (event: string, extra: object = {}) =>
    log({ event, ...key, ...extra, ts: new Date(now()).toISOString() });
  const E = voice.AgentSessionEventTypes;
  let turnStart: number | undefined;
  let turn = 0;
  session.on(E.AgentStateChanged, (ev) => {
    if (ev.newState === "thinking") {
      turn += 1;
      turnStart = now();
      line("turn_start", { turn });
    } else if (ev.oldState === "speaking" || ev.oldState === "thinking") {
      if (ev.newState === "listening" && turnStart !== undefined) {
        line("turn_end", { turn, durationMs: now() - turnStart, from: ev.oldState });
        turnStart = undefined;
      }
    }
    line("agent_state", { from: ev.oldState, to: ev.newState });
  });
  session.on(E.UserStateChanged, (ev) =>
    line("user_state", { from: ev.oldState, to: ev.newState }),
  );
  session.on(E.UserInputTranscribed, (ev) => {
    if (ev.isFinal) line("user_transcript", { chars: ev.transcript.length });
  });
  session.on(E.SpeechCreated, (ev) =>
    line("speech_created", { source: ev.source, userInitiated: ev.userInitiated }),
  );
  session.on(E.AgentFalseInterruption, () => line("false_interruption"));
  session.on(E.FunctionToolsExecuted, (ev) =>
    line("tools_executed", {
      tools: ev.functionCalls.map((c) => c.name),
      errors: ev.functionCallOutputs.filter((o) => o.isError).length,
    }),
  );
  session.on(E.ConversationItemAdded, (ev) => {
    const item = ev.item;
    if (item.type === "message" && item.role === "assistant" && item.interrupted) {
      line("interrupted", { turn, chars: (item.textContent ?? "").length });
    }
  });
  // LLM, TTS and STT failures, recoverable or not; `source` says which stream.
  session.on(E.Error, (ev) => {
    const inner = ev.error as { error?: unknown; recoverable?: boolean; type?: string };
    line("session_error", {
      source: ev.source?.constructor?.name,
      kind: inner.type,
      recoverable: inner.recoverable,
      ...errText(inner.error ?? ev.error),
    });
  });
  session.on(E.Close, (ev) =>
    line("session_close", {
      reason: String(ev.reason),
      ...(ev.error ? errText((ev.error as { error?: unknown }).error ?? ev.error) : {}),
    }),
  );
}

/** Log LLM / TTS stream start and end around a model, so a hung stream shows a start with no end. */
export function logStreams(session: voice.AgentSession, key: LogKey, log: Log = writeLog): void {
  session.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) => {
    const m = ev.metrics as { type?: string; durationMs?: number; duration?: number };
    if (m.type !== "llm_metrics" && m.type !== "tts_metrics" && m.type !== "stt_metrics") return;
    log({
      event: "stream_end",
      ...key,
      stream: m.type.replace("_metrics", ""),
      durationMs: Math.round(m.durationMs ?? (m.duration ?? 0) * 1000),
      ts: new Date().toISOString(),
    });
  });
}

/**
 * Process-level safety net for the job process: LiveKit only logs an unhandled rejection at
 * debug level, which hides the exception that precedes a stall.
 */
export function logProcessFaults(key: LogKey, log: Log = writeLog): () => void {
  const base = () => ({
    ...key,
    ts: new Date().toISOString(),
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
  });
  const onRejection = (reason: unknown) =>
    log({ event: "unhandled_rejection", ...base(), ...errText(reason) });
  const onException = (err: unknown) =>
    log({ event: "uncaught_exception", ...base(), ...errText(err) });
  const onSignal = (sig: NodeJS.Signals) => log({ event: "job_signal", signal: sig, ...base() });
  process.on("unhandledRejection", onRejection);
  process.on("uncaughtException", onException);
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  return () => {
    process.off("unhandledRejection", onRejection);
    process.off("uncaughtException", onException);
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
  };
}

/**
 * Event-loop stall and memory watch: a loop that stays blocked is how LiveKit decides a job is
 * unresponsive and kills it. Logs when a timer fires much later than planned.
 */
export function watchEventLoop(
  key: LogKey,
  log: Log = writeLog,
  opts: { intervalMs?: number; lateMs?: number; heartbeatMs?: number } = {},
): () => void {
  const interval = opts.intervalMs ?? 500;
  const late = opts.lateMs ?? 1_000;
  const heartbeat = opts.heartbeatMs ?? 30_000;
  let expected = Date.now() + interval;
  let lastBeat = Date.now();
  const timer = setInterval(() => {
    const t = Date.now();
    const lag = t - expected;
    expected = t + interval;
    const mem = process.memoryUsage();
    if (lag >= late) {
      log({
        event: "event_loop_stall",
        ...key,
        lagMs: lag,
        rssMb: Math.round(mem.rss / 1048576),
        ts: new Date(t).toISOString(),
      });
    }
    if (t - lastBeat >= heartbeat) {
      lastBeat = t;
      log({
        event: "job_heartbeat",
        ...key,
        rssMb: Math.round(mem.rss / 1048576),
        heapMb: Math.round(mem.heapUsed / 1048576),
        ts: new Date(t).toISOString(),
      });
    }
  }, interval);
  timer.unref();
  return () => clearInterval(timer);
}
