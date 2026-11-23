import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { InferenceRunner } from "@livekit/agents";
import "@livekit/agents-plugin-livekit";
import { describe, expect, it } from "vitest";
import {
  AUDIO_EOT_METHOD,
  ENGLISH_EOU_METHOD,
  idleProcessesFromEnv,
  pruneInferenceRunners,
} from "./inference.js";
import UnusedRunner from "./unused-runner.js";

// Prod ran out of memory (2 GiB) mid-call: the inference process loaded three turn-detection
// models (we use one) and LiveKit kept four idle job processes warm.
describe("inference memory", () => {
  it("keeps only the multilingual turn detector and takes the audio model's name", async () => {
    const registry = { ...InferenceRunner.registeredRunners };
    expect(Object.keys(registry)).toEqual(
      expect.arrayContaining([ENGLISH_EOU_METHOD, "lk_end_of_utterance_multilingual"]),
    );
    pruneInferenceRunners(registry);
    expect(Object.keys(registry).sort()).toEqual(
      [AUDIO_EOT_METHOD, "lk_end_of_utterance_multilingual"].sort(),
    );
    const mod = (await import(registry[AUDIO_EOT_METHOD]!)) as { default: typeof UnusedRunner };
    const runner = new mod.default();
    await expect(runner.initialize()).resolves.toBeUndefined();
    await expect(runner.run()).rejects.toThrow(/not loaded/);
  });

  it("uses the audio runner name @livekit/agents registers (guard for upgrades)", () => {
    const index = createRequire(import.meta.url).resolve("@livekit/agents");
    const runner = readFileSync(index.replace(/index\.c?js$/, "inference/eot/runner.js"), "utf8");
    expect(runner).toContain(`EOT_INFERENCE_METHOD = "${AUDIO_EOT_METHOD}"`);
  });

  it("keeps one idle job process unless configured", () => {
    expect(idleProcessesFromEnv({})).toBe(1);
    expect(idleProcessesFromEnv({ OPENBLAH_AGENT_IDLE_PROCESSES: "3" })).toBe(3);
    expect(idleProcessesFromEnv({ OPENBLAH_AGENT_IDLE_PROCESSES: "0" })).toBe(1);
    expect(idleProcessesFromEnv({ OPENBLAH_AGENT_IDLE_PROCESSES: "x" })).toBe(1);
  });
});
