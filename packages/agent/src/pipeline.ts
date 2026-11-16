import { type llm, type tts, voice } from "@livekit/agents";
import * as silero from "@livekit/agents-plugin-silero";
import * as livekitPlugin from "@livekit/agents-plugin-livekit";
import { type AgentConfig, directInstructions } from "./config.js";
import { detectLanguage } from "./language.js";
import { buildTurnLatencyLog, type TurnMetrics, writeLog } from "./latency.js";
import type { ProviderSet, SpokenLanguage, TtsProvider } from "./providers/types.js";

/** Barge-in: speech over the agent stops it after this much overlapping speech. */
export const BARGE_IN_MIN_DURATION_MS = 300;

/** Direct mode: one human, the agent answers every finished turn. */
export class DirectAgent extends voice.Agent {
  language: SpokenLanguage = "en";
  private ttsEngine: tts.TTS | undefined;

  constructor(
    cfg: Pick<AgentConfig, "agentName">,
    private readonly ttsProvider: TtsProvider,
  ) {
    super({ instructions: directInstructions(cfg) });
  }

  /** The session's TTS engine, so language changes reach it (the agent itself holds none). */
  bindTts(engine: tts.TTS | undefined): void {
    this.ttsEngine = engine;
  }

  /** Follow the language of the latest turn (English or Portuguese). */
  override async onUserTurnCompleted(_ctx: llm.ChatContext, msg: llm.ChatMessage): Promise<void> {
    this.applyLanguage(msg.textContent ?? "");
  }

  applyLanguage(text: string): SpokenLanguage {
    const next = detectLanguage(text, this.language);
    if (next !== this.language && this.ttsEngine) {
      this.ttsProvider.setLanguage(this.ttsEngine, next);
    }
    this.language = next;
    return next;
  }
}

/** Turn handling options: turn detector + VAD, barge-in and backchannel tolerance. */
export function turnHandling(
  turnDetection: voice.AgentSessionOptions["turnDetection"],
): NonNullable<voice.AgentSessionOptions["turnHandling"]> {
  return {
    turnDetection,
    interruption: {
      enabled: true,
      minDuration: BARGE_IN_MIN_DURATION_MS,
      // Short "mm-hm" / "yeah" must not cut the agent off; the agent resumes.
      resumeFalseInterruption: true,
      falseInterruptionTimeout: 2000,
    },
    endpointing: { minDelay: 400, maxDelay: 3000 },
    preemptiveGeneration: { enabled: true },
  };
}

/** Build the session options from providers. Pure, so tests can check them. */
export function buildSessionOptions(
  providers: ProviderSet,
  vad: voice.AgentSessionOptions["vad"],
  turnDetection: voice.AgentSessionOptions["turnDetection"],
): voice.AgentSessionOptions {
  return {
    stt: providers.stt.createStt(),
    llm: providers.llm.createLlm(),
    tts: providers.tts.createTts(),
    vad,
    turnHandling: turnHandling(turnDetection),
  };
}

/** Log end-of-speech to first-audio latency for each agent reply. */
export function attachLatencyLogging(
  session: voice.AgentSession,
  agent: DirectAgent,
  roomId?: string,
  log: (entry: object) => void = writeLog,
): void {
  let turn = 0;
  session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
    const item = ev.item;
    if (item.type !== "message" || item.role !== "assistant") return;
    turn += 1;
    log(
      buildTurnLatencyLog({
        roomId,
        turn,
        metrics: item.metrics as TurnMetrics | undefined,
        interrupted: item.interrupted,
        language: agent.language,
      }),
    );
  });
}

/** Load the heavy models once per worker process (prewarm). Only VAD: it needs no job. */
export async function loadModels() {
  return {
    vad: await silero.VAD.load(),
  };
}

/**
 * The turn detector needs a job context ("no job context found" otherwise), so
 * create it inside the job entrypoint, never in prewarm.
 */
export function createTurnDetector() {
  return new livekitPlugin.turnDetector.MultilingualModel();
}
