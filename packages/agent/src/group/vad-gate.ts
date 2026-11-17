/**
 * VAD gate: only audio near speech reaches the STT stream, so silent tracks
 * cost nothing (plan section 6). This one is an energy gate with a pre-roll
 * and a hangover, which is deterministic and needs no model, so it works for
 * the offline replay. In the live worker swap `isSpeech` for Silero VAD
 * (`@livekit/agents-plugin-silero`, already a dependency): the gate logic
 * (pre-roll, hangover, stats) stays the same.
 */
export interface VadGateOptions {
  /** RMS level (0-32767) above which a frame counts as speech. */
  threshold?: number;
  /** Keep sending this long after speech stops, so word endings are not cut. */
  hangoverMs?: number;
  /** Audio kept from before speech start, so first syllables are not cut. */
  prerollMs?: number;
  /** Replace the energy test, e.g. with a Silero probability check. */
  isSpeech?: (samples: Int16Array, sampleRate: number) => boolean;
}

export interface GateOutput {
  /** Frames to forward to STT (pre-roll included on the first call after opening). */
  forward: Int16Array[];
  /** The gate opened on this frame. */
  opened: boolean;
  /** The gate closed on this frame: flush the STT utterance. */
  closed: boolean;
}

export interface GateStats {
  totalMs: number;
  forwardedMs: number;
  /** Share of audio NOT sent to STT. */
  savedRatio: number;
}

export function rms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

export class VadGate {
  private readonly threshold: number;
  private readonly hangoverMs: number;
  private readonly prerollMs: number;
  private readonly isSpeech: (s: Int16Array, sr: number) => boolean;
  private open = false;
  private silentMs = 0;
  private preroll: { frame: Int16Array; ms: number }[] = [];
  private totalMs = 0;
  private forwardedMs = 0;

  constructor(opts: VadGateOptions = {}) {
    this.threshold = opts.threshold ?? 500;
    this.hangoverMs = opts.hangoverMs ?? 400;
    this.prerollMs = opts.prerollMs ?? 200;
    this.isSpeech = opts.isSpeech ?? ((s) => rms(s) >= this.threshold);
  }

  get isOpen(): boolean {
    return this.open;
  }

  push(frame: Int16Array, sampleRate: number): GateOutput {
    const ms = (frame.length / sampleRate) * 1000;
    this.totalMs += ms;
    const speech = this.isSpeech(frame, sampleRate);

    if (this.open) {
      this.forwardedMs += ms;
      if (speech) {
        this.silentMs = 0;
        return { forward: [frame], opened: false, closed: false };
      }
      this.silentMs += ms;
      if (this.silentMs >= this.hangoverMs) {
        this.open = false;
        this.silentMs = 0;
        return { forward: [frame], opened: false, closed: true };
      }
      return { forward: [frame], opened: false, closed: false };
    }

    if (speech) {
      this.open = true;
      this.silentMs = 0;
      const forward = [...this.preroll.map((p) => p.frame), frame];
      this.forwardedMs += this.preroll.reduce((a, p) => a + p.ms, 0) + ms;
      this.preroll = [];
      return { forward, opened: true, closed: false };
    }

    this.preroll.push({ frame, ms });
    let kept = this.preroll.reduce((a, p) => a + p.ms, 0);
    while (kept > this.prerollMs && this.preroll.length > 1) {
      kept -= this.preroll.shift()!.ms;
    }
    return { forward: [], opened: false, closed: false };
  }

  stats(): GateStats {
    return {
      totalMs: this.totalMs,
      forwardedMs: this.forwardedMs,
      savedRatio: this.totalMs === 0 ? 0 : 1 - this.forwardedMs / this.totalMs,
    };
  }
}
