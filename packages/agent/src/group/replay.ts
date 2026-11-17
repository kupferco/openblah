import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GroupBehaviour } from "./behaviour.js";
import { SpeakClassifier } from "./classifier.js";
import { scriptFor, type Scenario } from "./fixtures.js";
import { scriptedRecognizerFactory } from "./recognizers.js";
import { GroupSession } from "./session.js";
import type { RecognizerFactory, TurnDecision } from "./types.js";
import { readWav } from "./wav.js";

export interface ReplayOptions {
  agentName?: string;
  recognizer?: RecognizerFactory;
  classifier?: SpeakClassifier;
  /** Directory with `<scenario>/<Name>.wav`. */
  fixturesDir: string;
  onDecision?: (d: TurnDecision) => void;
  frameMs?: number;
  /** Behaviour to use; defaults to a new one in the scenario's mode, with the first participant as host. */
  behaviour?: GroupBehaviour;
}

export interface ReplayResult {
  transcript: string;
  decisions: TurnDecision[];
  /** Decision for the last human turn, which the scenario's `expected` refers to. */
  last?: TurnDecision;
  session: GroupSession;
  stats: ReturnType<GroupSession["gateStats"]>;
}

/**
 * Replay a scenario's WAV files as separate participants through one
 * GroupSession, frame by frame on a shared audio clock (faster than real time).
 */
export async function replayScenario(sc: Scenario, opts: ReplayOptions): Promise<ReplayResult> {
  const agentName = opts.agentName ?? "Blah";
  const session = new GroupSession({
    agentName,
    recognizer: opts.recognizer ?? scriptedRecognizerFactory(scriptFor(sc)),
    classifier: opts.classifier,
    behaviour:
      opts.behaviour ??
      new GroupBehaviour({
        agentName,
        mode: sc.mode,
        hostIdentity: sc.participants[0],
      }),
    onDecision: opts.onDecision ?? (() => {}),
  });
  const wavs = new Map<string, ReturnType<typeof readWav>>();
  for (const name of sc.participants) {
    wavs.set(name, readWav(readFileSync(join(opts.fixturesDir, sc.id, `${name}.wav`))));
    session.addParticipant(name, name);
  }
  const frameMs = opts.frameMs ?? 20;
  const first = wavs.values().next().value!;
  const frame = Math.floor((first.sampleRate * frameMs) / 1000);
  const length = Math.max(...[...wavs.values()].map((w) => w.samples.length));

  // Agent lines from the script enter the transcript at their time so follow-ups work.
  const agentLines = sc.turns.filter((t) => t.agent);
  let agentIdx = 0;
  for (let at = 0; at < length; at += frame) {
    const tMs = (at / first.sampleRate) * 1000;
    while (agentLines[agentIdx] && agentLines[agentIdx]!.startMs <= tMs) {
      session.addAgentLine(agentLines[agentIdx]!.text, agentLines[agentIdx]!.startMs);
      agentIdx++;
    }
    for (const [name, w] of wavs) {
      session.pushAudio(name, w.samples.subarray(at, at + frame), w.sampleRate, tMs);
    }
    // Let recognisers and classifiers run between frames, as they would live.
    await new Promise((r) => setImmediate(r));
  }
  await session.finish();
  return {
    transcript: session.transcript.format(),
    decisions: session.decisions,
    last: [...session.decisions].sort((a, b) => a.turnEndMs - b.turnEndMs).at(-1),
    session,
    stats: session.gateStats(),
  };
}
