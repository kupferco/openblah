import type { TranscriptLine } from "./types.js";

/**
 * Merged, speaker-tagged transcript across all human tracks (and the agent).
 * Lines are ordered by the time the turn ended; the tag is the display name,
 * so the LLM sees `[Penelope]: ...` without any diarization guesswork.
 */
export class MergedTranscript {
  private readonly _lines: TranscriptLine[] = [];

  add(line: TranscriptLine): TranscriptLine {
    const text = line.text.trim();
    if (!text) return line;
    const entry = { ...line, text };
    // Insert keeping order by turn end (tracks finish out of order).
    let i = this._lines.length;
    while (i > 0 && this._lines[i - 1]!.endMs > entry.endMs) i--;
    this._lines.splice(i, 0, entry);
    return entry;
  }

  get lines(): readonly TranscriptLine[] {
    return this._lines;
  }

  /** The last `n` lines up to and including `upTo` (defaults to the end). */
  recent(n: number, upTo?: TranscriptLine): TranscriptLine[] {
    const end = upTo ? this._lines.indexOf(upTo) + 1 : this._lines.length;
    return this._lines.slice(Math.max(0, end - n), end);
  }

  /** `[Penelope]: text` per line, the format given to the LLM. */
  format(lines: readonly TranscriptLine[] = this._lines): string {
    return lines.map((l) => `[${l.speaker}]: ${l.text}`).join("\n");
  }
}
