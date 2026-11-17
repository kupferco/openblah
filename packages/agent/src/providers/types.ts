import type { llm, stt, tts } from "@livekit/agents";

/**
 * Provider interfaces. Each one is a small factory around a LiveKit Agents
 * base class, so the voice pipeline never names a vendor. `llm.LLM` already
 * covers what the plan asks of an LLM provider: streaming chat
 * (`chat()` returns an async-iterable `LLMStream`) with tool calls, token usage
 * (reported as `LLMMetrics` / in each chunk's `usage`) and cancel
 * (`LLMStream.close()` and the abort signal). The model-agnostic adapters for
 * Claude and OpenAI come in T16.
 */
export interface SttProvider {
  /** Short provider name for logs, e.g. "deepgram". */
  readonly name: string;
  /** Create the streaming speech-to-text engine. */
  createStt(): stt.STT;
}

export interface LlmProvider {
  readonly name: string;
  /** Create the streaming chat model (tool calls, usage, cancel). */
  createLlm(): llm.LLM;
  /**
   * Convert an MCP tool's JSON schema to what this model accepts as function
   * parameters (each model supports a different subset of JSON Schema).
   */
  formatToolSchema?(schema: Record<string, unknown>): Record<string, unknown>;
}

export interface TtsProvider {
  readonly name: string;
  /**
   * Create the text-to-speech engine. The engine must accept a `language`
   * option via `updateOptions` so replies can follow the speaker.
   */
  createTts(): tts.TTS;
  /** Switch the spoken language ("en" or "pt") for the next replies. */
  setLanguage(engine: tts.TTS, language: SpokenLanguage): void;
}

export type SpokenLanguage = "en" | "pt";

export interface ProviderSet {
  stt: SttProvider;
  llm: LlmProvider;
  tts: TtsProvider;
}
