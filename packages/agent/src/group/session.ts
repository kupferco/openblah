import { detectLanguage } from "../language.js";
import { SpeakClassifier } from "./classifier.js";
import { MergedTranscript } from "./transcript.js";
import type { RecognizerFactory, TrackRecognizer, TurnDecision } from "./types.js";
import { VadGate, type GateStats, type VadGateOptions } from "./vad-gate.js";

export interface GroupSessionOptions {
  agentName: string;
  recognizer: RecognizerFactory;
  classifier?: SpeakClassifier;
  vad?: VadGateOptions;
  /** Pause the room needs before the agent may speak over humans (plan 2.4). */
  pauseBeforeSpeakMs?: number;
  /** Called for every classified turn; the default logs one JSON line. */
  onDecision?: (d: TurnDecision) => void;
}

interface Track {
  identity: string;
  name: string;
  gate: VadGate;
  rec: TrackRecognizer;
  /** Audio-clock time the track's gate last closed or last carried speech. */
  lastSpeechMs: number;
  done: Promise<void>;
}

/**
 * One agent, many humans. Each human audio track gets its own VAD gate and its
 * own recogniser; finished turns are merged into one speaker-tagged transcript
 * and each turn goes to the "should I speak?" classifier. The caller owns the
 * audio clock (`tMs`), so a replay can run faster than real time.
 */
export class GroupSession {
  readonly transcript = new MergedTranscript();
  readonly decisions: TurnDecision[] = [];
  private readonly tracks = new Map<string, Track>();
  private readonly pending: Promise<void>[] = [];
  private readonly classifier: SpeakClassifier;
  private readonly pauseMs: number;
  private lastLang: "en" | "pt" = "en";
  private nowMs = 0;

  constructor(private readonly opts: GroupSessionOptions) {
    this.classifier = opts.classifier ?? new SpeakClassifier();
    this.pauseMs = opts.pauseBeforeSpeakMs ?? 1000;
  }

  get participantNames(): string[] {
    return [...this.tracks.values()].map((t) => t.name);
  }

  addParticipant(identity: string, name: string): void {
    if (this.tracks.has(identity)) return;
    const rec = this.opts.recognizer({ identity, name });
    const track: Track = {
      identity,
      name,
      gate: new VadGate(this.opts.vad),
      rec,
      lastSpeechMs: -Infinity,
      done: Promise.resolve(),
    };
    track.done = this.consume(track);
    this.tracks.set(identity, track);
  }

  async removeParticipant(identity: string): Promise<void> {
    const t = this.tracks.get(identity);
    if (!t) return;
    t.rec.close();
    await t.done;
    this.tracks.delete(identity);
  }

  /** Push one frame of a human's mono PCM at audio-clock time `tMs` (start of the frame). */
  pushAudio(identity: string, frame: Int16Array, sampleRate: number, tMs: number): void {
    const t = this.tracks.get(identity);
    if (!t) throw new Error(`unknown participant ${identity}`);
    const frameMs = (frame.length / sampleRate) * 1000;
    this.nowMs = Math.max(this.nowMs, tMs + frameMs);
    const out = t.gate.push(frame, sampleRate);
    for (const f of out.forward) t.rec.push(f, sampleRate);
    if (t.gate.isOpen || out.closed) t.lastSpeechMs = tMs + frameMs;
    if (out.closed) t.rec.flush();
  }

  /** Record something the agent said, so follow-up questions can be recognised. */
  addAgentLine(text: string, endMs: number): void {
    this.transcript.add({
      identity: "agent",
      speaker: this.opts.agentName,
      text,
      endMs,
      isAgent: true,
    });
  }

  /** Flush open utterances, wait for all recognisers and classifications. */
  async finish(): Promise<void> {
    for (const t of this.tracks.values()) {
      if (t.gate.isOpen) t.rec.flush();
      t.rec.close();
    }
    await Promise.all([...this.tracks.values()].map((t) => t.done));
    await Promise.all(this.pending);
  }

  /** Per-track gate statistics, for the STT cost estimate. */
  gateStats(): Record<string, GateStats> {
    return Object.fromEntries([...this.tracks.values()].map((t) => [t.name, t.gate.stats()]));
  }

  private async consume(t: Track): Promise<void> {
    for await (const r of t.rec.results()) {
      // The turn ended when the track last carried speech.
      const line = this.transcript.add({
        identity: t.identity,
        speaker: t.name,
        text: r.text,
        endMs: t.lastSpeechMs,
      });
      if (!line.text) continue;
      this.pending.push(this.judge(line));
    }
  }

  private async judge(line: ReturnType<MergedTranscript["add"]>): Promise<void> {
    const started = Date.now();
    const context = this.transcript.recent(this.transcript.lines.length, line);
    const res = await this.classifier.classify({
      agentName: this.opts.agentName,
      participantNames: this.participantNames,
      transcript: context,
    });
    this.lastLang = detectLanguage(line.text, this.lastLang);
    const d: TurnDecision = {
      ...res,
      speaker: line.speaker,
      text: line.text,
      language: this.lastLang,
      turnEndMs: line.endMs,
      latencyMs: Date.now() - started,
    };
    if (d.decision === "speak") d.earliestSpeakMs = this.earliestSpeak(line);
    this.decisions.push(d);
    (this.opts.onDecision ?? logDecision)(d);
  }

  /**
   * Never talk over two humans: the agent waits until every track has been
   * quiet for `pauseMs`. Tracks that spoke after this turn push the time out.
   */
  private earliestSpeak(line: { endMs: number }): number {
    let latest = line.endMs;
    for (const t of this.tracks.values()) latest = Math.max(latest, t.lastSpeechMs);
    return latest + this.pauseMs;
  }
}

/** Structured log line: one JSON object per decision. */
export function logDecision(d: TurnDecision): void {
  console.log(JSON.stringify({ event: "group.decision", ...d }));
}
