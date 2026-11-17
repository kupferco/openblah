import { AudioFrame } from "@livekit/rtc-node";
import { stt } from "@livekit/agents";
import type { SttProvider } from "../providers/types.js";
import type { RecognizerFactory, TrackRecognizer } from "./types.js";

/** Small async queue so recognisers can expose results as an async iterable. */
class Queue<T> {
  private items: T[] = [];
  private waiters: ((r: IteratorResult<T>) => void)[] = [];
  private ended = false;
  push(v: T): void {
    const w = this.waiters.shift();
    if (w) w({ value: v, done: false });
    else this.items.push(v);
  }
  end(): void {
    this.ended = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined, done: true });
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((res) => this.waiters.push(res));
      },
    };
  }
}

/**
 * Real recogniser: one `SttProvider` stream per human track (Deepgram by
 * default). Only FINAL transcripts of an utterance are joined and emitted
 * when the gate closes (`flush`).
 */
export function sttRecognizerFactory(provider: SttProvider): RecognizerFactory {
  const engine = provider.createStt();
  return () => {
    const stream = engine.stream();
    const out = new Queue<{ text: string }>();
    let parts: string[] = [];
    const reader = (async () => {
      for await (const ev of stream) {
        if (ev.type === stt.SpeechEventType.FINAL_TRANSCRIPT) {
          const t = ev.alternatives?.[0]?.text?.trim();
          if (t) parts.push(t);
        } else if (ev.type === stt.SpeechEventType.END_OF_SPEECH && parts.length) {
          out.push({ text: parts.join(" ") });
          parts = [];
        }
      }
      if (parts.length) out.push({ text: parts.join(" ") });
      out.end();
    })();
    void reader;
    return {
      push(samples, sampleRate) {
        stream.pushFrame(new AudioFrame(samples, sampleRate, 1, samples.length));
      },
      flush: () => stream.flush(),
      close: () => stream.endInput(),
      results: () => out,
    } satisfies TrackRecognizer;
  };
}

/**
 * Offline recogniser for fixtures: emits the scripted text of each utterance
 * when the gate closes. It proves the plumbing (gate, per-track streams,
 * merge, classifier) without a network; it does not test recognition quality.
 */
export function scriptedRecognizerFactory(script: Record<string, string[]>): RecognizerFactory {
  return ({ identity }) => {
    const lines = [...(script[identity] ?? [])];
    const out = new Queue<{ text: string }>();
    let heard = false;
    return {
      push: () => {
        heard = true;
      },
      flush() {
        if (!heard) return;
        heard = false;
        const text = lines.shift();
        if (text) out.push({ text });
      },
      close: () => out.end(),
      results: () => out,
    };
  };
}
