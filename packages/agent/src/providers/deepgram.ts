import * as deepgram from "@livekit/agents-plugin-deepgram";
import type { SttProvider } from "./types.js";

/**
 * Deepgram streaming STT. `nova-3` with `language: "multi"` handles English
 * and Portuguese (and code switching) in one stream.
 * Alternatives: AssemblyAI, OpenAI or Google STT via their LiveKit plugins.
 */
export function deepgramStt(opts: { apiKey?: string; model?: string } = {}): SttProvider {
  return {
    name: "deepgram",
    createStt: () =>
      new deepgram.STT({
        apiKey: opts.apiKey,
        model: opts.model ?? "nova-3",
        language: "multi",
        interimResults: true,
        punctuate: true,
        smartFormat: true,
      }),
  };
}
