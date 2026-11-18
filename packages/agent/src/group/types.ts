/**
 * Shared types for group (multi-participant) listening. Nothing here depends
 * on LiveKit, so the whole module can be replayed offline from WAV files.
 */

export type Decision = "speak" | "stay_quiet";

/**
 * How the agent behaves in a room. `listening` (default) never speaks unless
 * addressed; `facilitating` may also speak briefly at natural pauses; `direct`
 * is one to one with the host.
 */
export type RoomMode = "listening" | "facilitating" | "direct";
export const ROOM_MODES: readonly RoomMode[] = ["listening", "facilitating", "direct"];

/** One finished line of the merged transcript. */
export interface TranscriptLine {
  /** Participant identity (stable id). */
  identity: string;
  /** Display name used in the tag, e.g. "Penelope". */
  speaker: string;
  text: string;
  /** Audio-clock time (ms since the session start) when the turn ended. */
  endMs: number;
  /** True when the line was spoken by the agent itself. */
  isAgent?: boolean;
}

/** A speech recogniser for exactly one human audio track. */
export interface TrackRecognizer {
  /** Push mono 16-bit PCM that already passed the VAD gate. */
  push(samples: Int16Array, sampleRate: number): void;
  /** The gate closed: finish the current utterance. */
  flush(): void;
  close(): void;
  /** Final transcripts for this track, in order. */
  results(): AsyncIterable<{ text: string }>;
}

export type RecognizerFactory = (participant: {
  identity: string;
  name: string;
}) => TrackRecognizer;

export interface ClassifierInput {
  agentName: string;
  /** Names of the other humans in the room. */
  participantNames: string[];
  /** Recent lines, oldest first; the last one is the turn to judge. */
  transcript: TranscriptLine[];
  /** Room mode; defaults to `listening`. */
  mode?: RoomMode;
  /** The agent is muted for everyone: it never speaks. */
  muted?: boolean;
  /** Display name of the host, used in `direct` mode. */
  hostName?: string;
}

export interface ClassifierResult {
  decision: Decision;
  reason: string;
  /** "rule" = decided without a model call, "llm" = model call, "fallback" = model failed. */
  source: "rule" | "llm" | "fallback";
}

export interface TurnDecision extends ClassifierResult {
  speaker: string;
  text: string;
  language: "en" | "pt";
  /** Audio-clock time the turn ended. */
  turnEndMs: number;
  /**
   * Earliest audio-clock time the agent may start speaking: the turn end
   * plus the pause the room needs, extended while any human keeps talking.
   * Only set when decision is `speak`.
   */
  earliestSpeakMs?: number;
  latencyMs: number;
  /** Mode and mute state when the decision was made. */
  mode?: RoomMode;
  muted?: boolean;
  /** Set when a Facilitating rule fired: what to say, in one or two sentences. */
  facilitation?: { kind: string; instruction: string };
  /** Set when the turn was a voice command (mode change, mute, note, action). */
  command?: string;
}
