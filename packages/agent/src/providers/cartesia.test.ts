import { describe, expect, it, vi } from "vitest";
import type { tts } from "@livekit/agents";
import { CARTESIA_VOICES, cartesiaTts } from "./cartesia.js";
import { createTtsProvider } from "./select.js";

// Housekeeper in Portuguese was read by Cartesia's default American English voice.
describe("Cartesia native voice per language", () => {
  const engine = () => ({ updateOptions: vi.fn() });

  it("switches to a native voice with the language, and back", () => {
    const p = cartesiaTts({ apiKey: "k" });
    const e = engine();
    p.setLanguage(e as unknown as tts.TTS, "pt");
    expect(e.updateOptions).toHaveBeenLastCalledWith({ language: "pt", voice: CARTESIA_VOICES.pt });
    p.setLanguage(e as unknown as tts.TTS, "en");
    expect(e.updateOptions).toHaveBeenLastCalledWith({ language: "en", voice: CARTESIA_VOICES.en });
  });

  it("takes the voices from the environment", () => {
    const p = createTtsProvider(
      { provider: "cartesia" },
      { CARTESIA_API_KEY: "k", CARTESIA_VOICE_ID: "voice-en", CARTESIA_VOICE_ID_PT: "voice-pt" },
    );
    const e = engine();
    p.setLanguage(e as unknown as tts.TTS, "pt");
    expect(e.updateOptions).toHaveBeenLastCalledWith({ language: "pt", voice: "voice-pt" });
    p.setLanguage(e as unknown as tts.TTS, "en");
    expect(e.updateOptions).toHaveBeenLastCalledWith({ language: "en", voice: "voice-en" });
  });
});
