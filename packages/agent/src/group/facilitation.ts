import type { TranscriptLine } from "./types.js";

export type FacilitationKind = "decision_reached" | "open_action" | "long_silence" | "time_check";

export interface FacilitationHit {
  kind: FacilitationKind;
  /** What the agent should say, in one or two short sentences. */
  instruction: string;
}

export interface FacilitatorOptions {
  /** Silence after a question before the agent chips in. */
  silenceAfterQuestionMs?: number;
  /** Time check interval; 0 turns it off. */
  timeCheckEveryMs?: number;
  /** Minimum gap between two facilitation remarks. */
  minGapMs?: number;
}

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

const DECISION = [
  /\b(let'?s|we'?ll|we will|we'?re going to) go with\b/,
  /\bwe (have )?(decided|agreed|settled)\b/,
  /\b(it'?s|that'?s) (decided|settled|agreed)\b/,
  /\bdeal\b.*\b(then|agreed)\b/,
  /\bvamos (com|de|fechar)\b/,
  /\b(ficou|esta) (decidido|combinado|fechado)\b/,
  /\bdecidimos\b/,
  /\bcombinado\b/,
];

const OPEN_ACTION = [
  /\b(someone|somebody) (needs|has|should|must|will have) to\b/,
  /\bwe (still )?need to (book|send|call|decide|buy|check|write|find)\b/,
  /\bwho (will|is going to|can|'?s going to)\b/,
  /\balguem (precisa|tem que|deveria|vai)\b/,
  /\bquem vai\b/,
  /\bprecisamos (reservar|enviar|ligar|decidir|comprar|verificar|escrever|achar)\b/,
];

/**
 * The Facilitating-mode rules: decision reached, open action, long silence
 * after a question, time check. Deterministic and cheap; the agent only gets
 * a short instruction and still writes the sentence itself.
 */
export class Facilitator {
  private readonly silenceMs: number;
  private readonly timeEveryMs: number;
  private readonly minGapMs: number;
  private lastRemarkMs = -Infinity;
  private questionAskedAtMs: number | null = null;
  private questionHandled = false;
  private nextTimeCheckMs: number;

  constructor(opts: FacilitatorOptions = {}, startMs = 0) {
    this.silenceMs = opts.silenceAfterQuestionMs ?? 8_000;
    this.timeEveryMs = opts.timeCheckEveryMs ?? 30 * 60_000;
    this.minGapMs = opts.minGapMs ?? 45_000;
    this.nextTimeCheckMs = this.timeEveryMs > 0 ? startMs + this.timeEveryMs : Infinity;
  }

  /** A finished human turn. Returns a hit when a content rule fires. */
  onTurn(line: TranscriptLine): FacilitationHit | null {
    const isQuestion = /\?\s*$/.test(line.text.trim());
    this.questionAskedAtMs = isQuestion ? line.endMs : null;
    this.questionHandled = false;
    if (line.endMs - this.lastRemarkMs < this.minGapMs) return null;
    const t = norm(line.text);
    if (DECISION.some((re) => re.test(t))) {
      return this.fire(line.endMs, {
        kind: "decision_reached",
        instruction:
          "Briefly repeat the decision that was just reached and ask if everyone agrees. One or two sentences.",
      });
    }
    if (OPEN_ACTION.some((re) => re.test(t))) {
      return this.fire(line.endMs, {
        kind: "open_action",
        instruction:
          "Point out that this task has no owner yet and ask who takes it. One short sentence.",
      });
    }
    return null;
  }

  /**
   * Called as the audio clock moves. `quietSinceMs` is when the last human
   * speech ended; the rules only fire when the room is quiet.
   */
  tick(nowMs: number, quietSinceMs: number): FacilitationHit | null {
    if (nowMs - quietSinceMs < this.silenceMs && nowMs < this.nextTimeCheckMs) return null;
    if (nowMs - this.lastRemarkMs < this.minGapMs) return null;
    if (
      this.questionAskedAtMs !== null &&
      !this.questionHandled &&
      nowMs - Math.max(quietSinceMs, this.questionAskedAtMs) >= this.silenceMs
    ) {
      this.questionHandled = true;
      return this.fire(nowMs, {
        kind: "long_silence",
        instruction:
          "Nobody answered the last question. Gently repeat it or offer help to answer it. One short sentence.",
      });
    }
    if (nowMs >= this.nextTimeCheckMs && nowMs - quietSinceMs >= 1_000) {
      this.nextTimeCheckMs = nowMs + this.timeEveryMs;
      return this.fire(nowMs, {
        kind: "time_check",
        instruction: `Say how long the call has been going (about ${Math.round(nowMs / 60_000)} minutes) and ask if they want to wrap up. One short sentence.`,
      });
    }
    return null;
  }

  private fire(nowMs: number, hit: FacilitationHit): FacilitationHit {
    this.lastRemarkMs = nowMs;
    return hit;
  }
}
