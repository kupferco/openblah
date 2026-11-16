import * as cartesia from "@livekit/agents-plugin-cartesia";
import type { SpokenLanguage, TtsProvider } from "./types.js";

/**
 * Cartesia Sonic TTS (low latency, multilingual: English and Portuguese).
 * Alternatives: ElevenLabs, OpenAI or Google TTS via their LiveKit plugins.
 * The voice is a Cartesia voice ID; sonic-3 voices speak every language, so
 * only the `language` option changes per turn.
 */
export function cartesiaTts(
  opts: { apiKey?: string; model?: string; voice?: string } = {},
): TtsProvider {
  return {
    name: "cartesia",
    createTts: () =>
      new cartesia.TTS({
        apiKey: opts.apiKey,
        model: opts.model ?? "sonic-3",
        ...(opts.voice ? { voice: opts.voice } : {}),
        language: "en",
      }),
    setLanguage(engine, language: SpokenLanguage) {
      (engine as cartesia.TTS).updateOptions({ language });
    },
  };
}
