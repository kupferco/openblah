import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stt } from "@livekit/agents";
import { AudioFrame } from "@livekit/rtc-node";
import type { SttProvider, TtsProvider } from "../providers/types.js";
import type { EvalCase } from "./cases.js";

/** Audio fixtures are generated from the case text, not committed (they are binary and cost TTS credits). */
export const AUDIO_DIR = new URL("../../eval-audio/", import.meta.url).pathname;

export const wavPath = (id: string) => join(AUDIO_DIR, `${id}.wav`);

/** 16-bit mono PCM to a WAV file buffer. */
export function encodeWav(pcm: Int16Array, sampleRate: number): Buffer {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Read back a WAV written by encodeWav. */
export function decodeWav(buf: Buffer): { pcm: Int16Array; sampleRate: number } {
  const sampleRate = buf.readUInt32LE(24);
  const body = buf.subarray(44);
  const pcm = new Int16Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.length));
  return { pcm, sampleRate };
}

/** Speak a case's text with a TTS adapter and save it as a WAV fixture. Returns seconds of audio and ms taken. */
export async function makeAudio(tts: TtsProvider, c: EvalCase) {
  const engine = tts.createTts();
  tts.setLanguage(engine, c.lang);
  const t0 = performance.now();
  const chunks: Int16Array[] = [];
  let sampleRate = engine.sampleRate;
  let firstMs = NaN;
  for await (const audio of engine.synthesize(c.text)) {
    if (Number.isNaN(firstMs)) firstMs = performance.now() - t0;
    chunks.push(audio.frame.data);
    sampleRate = audio.frame.sampleRate;
  }
  await engine.close();
  const pcm = new Int16Array(chunks.reduce((n, x) => n + x.length, 0));
  let at = 0;
  for (const x of chunks) {
    pcm.set(x, at);
    at += x.length;
  }
  mkdirSync(AUDIO_DIR, { recursive: true });
  writeFileSync(wavPath(c.id), encodeWav(pcm, sampleRate));
  return { seconds: pcm.length / sampleRate, firstMs };
}

/** Run a saved fixture through an STT adapter and return the final transcript and ms to it. */
export async function transcribe(provider: SttProvider, c: EvalCase) {
  const { pcm, sampleRate } = decodeWav(readFileSync(wavPath(c.id)));
  const engine = provider.createStt();
  const stream = engine.stream();
  const t0 = performance.now();
  const step = Math.floor(sampleRate / 50); // 20 ms
  for (let i = 0; i < pcm.length; i += step) {
    const part = pcm.slice(i, i + step);
    stream.pushFrame(new AudioFrame(part, sampleRate, 1, part.length));
  }
  // A second of silence so the engine ends the utterance.
  stream.pushFrame(new AudioFrame(new Int16Array(sampleRate), sampleRate, 1, sampleRate));
  stream.endInput();
  const parts: string[] = [];
  for await (const ev of stream) {
    if (ev.type === stt.SpeechEventType.FINAL_TRANSCRIPT && ev.alternatives?.[0]?.text) {
      parts.push(ev.alternatives[0].text);
    }
  }
  await engine.close();
  return { text: parts.join(" ").trim(), ms: performance.now() - t0 };
}

const words = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean);

/** Word error rate (edit distance over words / reference words), accents and punctuation ignored. */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const r = words(reference);
  const h = words(hypothesis);
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0]![j] = j;
  for (let i = 1; i <= r.length; i++)
    for (let j = 1; j <= h.length; j++)
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (r[i - 1] === h[j - 1] ? 0 : 1),
      );
  return d[r.length]![h.length]! / r.length;
}
