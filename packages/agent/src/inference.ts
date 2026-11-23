import { InferenceRunner } from "@livekit/agents";

/**
 * LiveKit's inference process loads every registered model at start-up, used or not.
 * Importing `@livekit/agents-plugin-livekit` registers its English and multilingual
 * text turn detectors, and the worker adds the core audio end-of-turn model unless
 * that name is taken. We only use the multilingual one (`createTurnDetector`); the
 * other two cost about 180 MB and 400 MB, which pushed prod past its 2 GiB limit.
 */
export const ENGLISH_EOU_METHOD = "lk_end_of_utterance_en";
/** Name of the core audio end-of-turn runner (not exported by @livekit/agents). */
export const AUDIO_EOT_METHOD = "lk_eot_audio";

/** Drop the turn-detection models the agent never calls. Run in the main process before the worker starts. */
export function pruneInferenceRunners(
  registry: Record<string, string> = InferenceRunner.registeredRunners,
): void {
  delete registry[ENGLISH_EOU_METHOD];
  // Taking the name stops the worker registering the real audio model.
  if (!registry[AUDIO_EOT_METHOD]) {
    registry[AUDIO_EOT_METHOD] = new URL(
      `./unused-runner${import.meta.url.endsWith(".ts") ? ".ts" : ".js"}`,
      import.meta.url,
    ).toString();
  }
}

/**
 * Job processes kept warm. LiveKit's production default is min(CPUs, 4), about 200 MB
 * each; one is enough for an instance that runs a call or two (`OPENBLAH_AGENT_IDLE_PROCESSES`).
 * LiveKit treats 0 as "use the default", so 1 is the minimum.
 */
export function idleProcessesFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(env.OPENBLAH_AGENT_IDLE_PROCESSES ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}
