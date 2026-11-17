import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";
import type { SpokenLanguage, TtsProvider } from "./types.js";

/**
 * ElevenLabs text to speech. `eleven_flash_v2_5` is the low-latency multilingual
 * model (English and Portuguese); the language code is switched per reply.
 */
export function elevenLabsTts(
  opts: { apiKey?: string; model?: string; voiceId?: string } = {},
): TtsProvider {
  return {
    name: "elevenlabs",
    createTts: () =>
      new elevenlabs.TTS({
        apiKey: opts.apiKey,
        model: opts.model ?? "eleven_flash_v2_5",
        ...(opts.voiceId ? { voiceId: opts.voiceId } : {}),
        language: "en",
      }),
    setLanguage(engine, language: SpokenLanguage) {
      (engine as elevenlabs.TTS).updateOptions({ language });
    },
  };
}
