import * as cartesia from "@livekit/agents-plugin-cartesia";
import type { SpokenLanguage, TtsProvider } from "./types.js";

/**
 * Native Cartesia voice per spoken language. A sonic-3 voice can read any language, but
 * with the accent of its own: the plugin default (Katie, American English) reading
 * Portuguese sounded American. So the voice switches together with the language.
 */
export const CARTESIA_VOICES: Record<SpokenLanguage, string> = {
  /** Katie - Friendly Fixer (en): the plugin default. */
  en: "f786b574-daa5-4673-aa0c-cbe3e8534c02",
  /** Larissa - Bright Companion (pt): friendly Brazilian female, everyday conversation. */
  pt: "8d826d43-20ad-4c56-8d37-1048eccca1bf",
};

/**
 * Cartesia Sonic TTS (low latency, English and Portuguese).
 * Alternatives: ElevenLabs, OpenAI or Google TTS via their LiveKit plugins.
 * `voice` is the English voice (`CARTESIA_VOICE_ID` / `OPENBLAH_TTS_VOICE`), `voicePt` the
 * Portuguese one (`CARTESIA_VOICE_ID_PT`); each defaults to a native voice.
 */
export function cartesiaTts(
  opts: { apiKey?: string; model?: string; voice?: string; voicePt?: string } = {},
): TtsProvider {
  const voices: Record<SpokenLanguage, string> = {
    en: opts.voice || CARTESIA_VOICES.en,
    pt: opts.voicePt || CARTESIA_VOICES.pt,
  };
  return {
    name: "cartesia",
    createTts: () =>
      new cartesia.TTS({
        apiKey: opts.apiKey,
        model: opts.model ?? "sonic-3",
        voice: voices.en,
        language: "en",
      }),
    setLanguage(engine, language: SpokenLanguage) {
      (engine as cartesia.TTS).updateOptions({ language, voice: voices[language] });
    },
  };
}
