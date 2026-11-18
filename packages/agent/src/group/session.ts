import { detectLanguage } from "../language.js";
import { GroupBehaviour } from "./behaviour.js";
import { SpeakClassifier } from "./classifier.js";
import { MergedTranscript } from "./transcript.js";
import type {
  ClassifierResult,
  RecognizerFactory,
  TrackRecognizer,
  TurnDecision,
} from "./types.js";
import { VadGate, type GateStats, type VadGateOptions } from "./vad-gate.js";

export interface GroupSessionOptions {
  agentName: string;
  recognizer: RecognizerFactory;
  classifier?: SpeakClassifier;
  vad?: VadGateOptions;
  /** Pause the room needs before the agent may speak over humans (plan 2.4). */
  pauseBeforeSpeakMs?: number;
  /** Mode, mute, notes and facilitation. Defaults to Listening mode. */
  behaviour?: GroupBehaviour;
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
  readonly behaviour: GroupBehaviour;
  private lastLang: "en" | "pt" = "en";
  private nowMs = 0;

  constructor(private readonly opts: GroupSessionOptions) {
    this.classifier = opts.classifier ?? new SpeakClassifier();
    this.pauseMs = opts.pauseBeforeSpeakMs ?? 1000;
    this.behaviour = opts.behaviour ?? new GroupBehaviour({ agentName: opts.agentName });
  }

  /** The language of the room: the one most human lines were spoken in. */
  get language(): "en" | "pt" {
    return this.lastLang;
  }

  /** Name of the host among the current participants, for Direct mode. */
  private hostName(): string | undefined {
    const id = this.behaviour.hostIdentity;
    return id ? this.tracks.get(id)?.name : undefined;
  }

  /**
   * Move the audio clock without new audio (a real call does this on a timer).
   * In Facilitating mode this may fire a rule: a long silence after a question,
   * or a time check. Returns the decision when one fired.
   */
  tick(nowMs: number): TurnDecision | null {
    this.nowMs = Math.max(this.nowMs, nowMs);
    const b = this.behaviour;
    if (b.mode !== "facilitating" || b.muted) return null;
    let quiet = 0;
    for (const t of this.tracks.values()) {
      if (t.gate.isOpen) return null;
      quiet = Math.max(quiet, t.lastSpeechMs);
    }
    const hit = b.facilitator.tick(nowMs, quiet);
    if (!hit) return null;
    const d: TurnDecision = {
      decision: "speak",
      reason: `facilitating: ${hit.kind}`,
      source: "rule",
      speaker: "",
      text: "",
      language: this.lastLang,
      turnEndMs: nowMs,
      earliestSpeakMs: Math.max(nowMs, quiet + this.pauseMs),
      latencyMs: 0,
      mode: b.mode,
      muted: b.muted,
      facilitation: hit,
    };
    this.decisions.push(d);
    (this.opts.onDecision ?? logDecision)(d);
    return d;
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
    const b = this.behaviour;
    this.lastLang = detectLanguage(line.text, this.lastLang);
    const stamp = { mode: b.mode, muted: b.muted };

    // 1. Spoken commands: mode, mute, notes, actions.
    const cmd = b.handleVoiceCommand(line, this.participantNames, this.lastLang);
    let res: ClassifierResult;
    let extra: Partial<TurnDecision> = {};
    if (cmd) {
      res = {
        decision: cmd.say && !b.muted ? "speak" : "stay_quiet",
        reason: `voice command: ${cmd.label}`,
        source: "rule",
      };
      extra = { command: cmd.label };
    } else {
      // 2. "Should I speak?" on the finished turn.
      const context = this.transcript.recent(this.transcript.lines.length, line);
      res = await this.classifier.classify({
        agentName: this.opts.agentName,
        participantNames: this.participantNames,
        transcript: context,
        mode: b.mode,
        muted: b.muted,
        hostName: this.hostName(),
      });
      // 3. Facilitating rules, only when nothing else says to speak.
      if (res.decision === "stay_quiet" && b.mode === "facilitating" && !b.muted) {
        const hit = b.facilitator.onTurn(line);
        if (hit) {
          res = { decision: "speak", reason: `facilitating: ${hit.kind}`, source: "rule" };
          extra = { facilitation: hit };
        }
      }
    }
    const d: TurnDecision = {
      ...res,
      ...stamp,
      ...extra,
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
