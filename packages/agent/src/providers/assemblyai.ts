import * as assemblyai from "@livekit/agents-plugin-assemblyai";
import type { SttProvider } from "./types.js";

/** AssemblyAI streaming STT with language detection (English and Portuguese). */
export function assemblyAiStt(opts: { apiKey?: string } = {}): SttProvider {
  return {
    name: "assemblyai",
    createStt: () =>
      new assemblyai.STT({
        apiKey: opts.apiKey,
        languageDetection: true,
      }),
  };
}
