import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RoomMode } from "./types.js";
import { writeWav } from "./wav.js";

export const FIXTURE_RATE = 16_000;

export interface FixtureTurn {
  speaker: string; // participant display name
  text: string;
  startMs: number;
  /** An earlier agent line already in the transcript (no audio). */
  agent?: boolean;
}

export interface Scenario {
  id: string;
  language: "en" | "pt";
  description: string;
  participants: string[];
  turns: FixtureTurn[];
  /** Expected decision for the LAST human turn. */
  expected: "speak" | "stay_quiet";
  /** Room mode at the start (default listening). */
  mode?: RoomMode;
  /** Room mode expected at the end, when the scenario changes it. */
  expectedMode?: RoomMode;
  /** Facilitating rule expected on the last turn. */
  expectedFacilitation?: string;
}

/** Fixture scenarios: addressed by name, humans talking, opinion requested, wrong name. */
export const SCENARIOS: Scenario[] = [
  {
    id: "en-addressed",
    language: "en",
    description: "Addressed by name",
    participants: ["Dani", "Penelope"],
    turns: [
      { speaker: "Dani", text: "Penelope and I are picking a date for the launch.", startMs: 300 },
      { speaker: "Penelope", text: "Friday works for me.", startMs: 4200 },
      { speaker: "Dani", text: "Blah, what do you think about Friday?", startMs: 7000 },
    ],
    expected: "speak",
  },
  {
    id: "en-humans",
    language: "en",
    description: "Humans talking to each other: stay quiet",
    participants: ["Dani", "Penelope"],
    turns: [
      { speaker: "Dani", text: "Did you book the restaurant for tonight?", startMs: 300 },
      { speaker: "Penelope", text: "Yes, at eight, near the station.", startMs: 3600 },
      { speaker: "Dani", text: "Great, I will bring the tickets.", startMs: 6800 },
    ],
    expected: "stay_quiet",
  },
  {
    id: "en-other-name",
    language: "en",
    description: "A human asks the other human for an opinion: stay quiet",
    participants: ["Dani", "Penelope"],
    turns: [
      { speaker: "Dani", text: "The cheaper hotel is further out.", startMs: 300 },
      { speaker: "Dani", text: "Penelope, what do you think?", startMs: 3500 },
    ],
    expected: "stay_quiet",
  },
  {
    id: "en-opinion",
    language: "en",
    description: "Opinion requested right after the agent spoke",
    participants: ["Dani", "Penelope"],
    turns: [
      { speaker: "Dani", text: "Blah, summarise the two hotels for us.", startMs: 300 },
      {
        speaker: "Blah",
        text: "One is cheaper but far out, the other is central and costs forty more.",
        startMs: 5000,
        agent: true,
      },
      { speaker: "Dani", text: "What do you think about the central one?", startMs: 9500 },
    ],
    expected: "speak",
  },
  {
    id: "pt-addressed",
    language: "pt",
    description: "Addressed by name in Portuguese",
    participants: ["Dani", "Penelope"],
    turns: [
      { speaker: "Penelope", text: "Precisamos decidir o orçamento hoje.", startMs: 300 },
      { speaker: "Dani", text: "Blah, qual é a sua opinião sobre o orçamento?", startMs: 4000 },
    ],
    expected: "speak",
  },
  {
    id: "pt-humans",
    language: "pt",
    description: "Humans talking in Portuguese, one asks the other: stay quiet",
    participants: ["Dani", "Penelope", "Marta"],
    turns: [
      { speaker: "Marta", text: "Quem vai buscar a mãe no aeroporto?", startMs: 300 },
      { speaker: "Dani", text: "Penelope, o que você acha do horário?", startMs: 3600 },
    ],
    expected: "stay_quiet",
  },
];

/** T9 scenarios: modes, notes, mute and Facilitating rules. */
export const BEHAVIOUR_SCENARIOS: Scenario[] = [
  {
    id: "en-chat-long",
    language: "en",
    description: "Two humans keep talking for four turns: silence, even in Facilitating mode",
    mode: "facilitating",
    participants: ["Dani", "Penelope"],
    turns: [
      { speaker: "Dani", text: "How was the flight back yesterday?", startMs: 300 },
      { speaker: "Penelope", text: "Long, but the seats were fine.", startMs: 3800 },
      { speaker: "Dani", text: "Did you sleep a little at least?", startMs: 7000 },
      { speaker: "Penelope", text: "Two hours, I am still tired.", startMs: 10200 },
    ],
    expected: "stay_quiet",
  },
  {
    id: "en-decision",
    language: "en",
    description: "Facilitating: a decision is reached, the agent speaks briefly",
    mode: "facilitating",
    participants: ["Dani", "Penelope"],
    turns: [
      { speaker: "Penelope", text: "Friday or Monday for the launch?", startMs: 300 },
      { speaker: "Dani", text: "Okay, we decided, let's go with Friday.", startMs: 3600 },
    ],
    expected: "speak",
    expectedFacilitation: "decision_reached",
  },
  {
    id: "en-decision-listening",
    language: "en",
    description: "Listening (default): the same decision is not commented on",
    participants: ["Dani", "Penelope"],
    turns: [
      { speaker: "Penelope", text: "Friday or Monday for the launch?", startMs: 300 },
      { speaker: "Dani", text: "Okay, we decided, let's go with Friday.", startMs: 3600 },
    ],
    expected: "stay_quiet",
  },
  {
    id: "en-open-action",
    language: "en",
    description: "Facilitating: a task has no owner, the agent asks who takes it",
    mode: "facilitating",
    participants: ["Dani", "Penelope"],
    turns: [
      {
        speaker: "Dani",
        text: "Someone needs to book the venue before the weekend.",
        startMs: 300,
      },
    ],
    expected: "speak",
    expectedFacilitation: "open_action",
  },
  {
    id: "en-switch-mode",
    language: "en",
    description: "Switch to Facilitating by voice",
    participants: ["Dani", "Penelope"],
    turns: [{ speaker: "Dani", text: "Blah, switch to facilitating mode.", startMs: 300 }],
    expected: "speak",
    expectedMode: "facilitating",
  },
  {
    id: "pt-switch-mode",
    language: "pt",
    description: "Switch to Listening by voice, in Portuguese",
    mode: "facilitating",
    participants: ["Dani", "Penelope"],
    turns: [{ speaker: "Dani", text: "Blah, só ouça por favor.", startMs: 300 }],
    expected: "speak",
    expectedMode: "listening",
  },
  {
    id: "en-mute",
    language: "en",
    description: "Muted for everyone: even when addressed the agent stays quiet",
    participants: ["Dani", "Penelope"],
    turns: [
      { speaker: "Penelope", text: "Blah, mute yourself for a bit.", startMs: 300 },
      { speaker: "Dani", text: "Blah, what do you think about Friday?", startMs: 4200 },
    ],
    expected: "stay_quiet",
  },
  {
    id: "en-notes",
    language: "en",
    description: "Notes and actions by voice, then asked for the open actions",
    participants: ["Dani", "Penelope"],
    turns: [
      { speaker: "Dani", text: "Blah, note that the launch is on Friday.", startMs: 300 },
      { speaker: "Dani", text: "Blah, add an action: Penelope sends the invoice.", startMs: 4200 },
      { speaker: "Penelope", text: "Blah, what is still open?", startMs: 9000 },
    ],
    expected: "speak",
  },
  {
    id: "en-direct",
    language: "en",
    description: "Direct mode: the host talks, the agent answers without its name",
    mode: "direct",
    participants: ["Dani"],
    turns: [{ speaker: "Dani", text: "What is the capital of Portugal?", startMs: 300 }],
    expected: "speak",
  },
];

/** Deterministic speech-like signal: a voiced burst per word, a short gap between words. */
export function synthSpeech(text: string, seed = 1): Int16Array {
  const rate = FIXTURE_RATE;
  const parts: Int16Array[] = [];
  let s = seed;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const f0 = 110 + (s % 90);
    const n = Math.floor(((90 + word.length * 55) / 1000) * rate);
    const w = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const env = Math.sin((Math.PI * i) / n) ** 0.5;
      const v =
        Math.sin(2 * Math.PI * f0 * t) +
        0.5 * Math.sin(2 * Math.PI * 2 * f0 * t) +
        0.25 * Math.sin(2 * Math.PI * 3 * f0 * t);
      w[i] = Math.round(env * v * 6000);
    }
    parts.push(w, new Int16Array(Math.floor(0.07 * rate)));
  }
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Int16Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Build the full-length track for one participant (silence plus their turns). */
export function renderTrack(sc: Scenario, speaker: string, totalMs: number): Int16Array {
  const out = new Int16Array(Math.ceil((totalMs / 1000) * FIXTURE_RATE));
  let seed = 1;
  for (const t of sc.turns) {
    seed++;
    if (t.speaker !== speaker || t.agent) continue;
    const sp = synthSpeech(t.text, seed);
    out.set(sp, Math.floor((t.startMs / 1000) * FIXTURE_RATE));
  }
  return out;
}

export function scenarioDurationMs(sc: Scenario): number {
  let end = 0;
  for (const t of sc.turns) {
    if (t.agent) continue;
    end = Math.max(end, t.startMs + (synthSpeech(t.text).length / FIXTURE_RATE) * 1000);
  }
  return Math.ceil(end + 3000);
}

/** Humans only (the agent has no audio fixture). */
export function humans(sc: Scenario): string[] {
  return sc.participants;
}

/** Scripted utterances per participant, in order, for the offline recogniser. */
export function scriptFor(sc: Scenario): Record<string, string[]> {
  const script: Record<string, string[]> = {};
  for (const t of sc.turns) if (!t.agent) (script[t.speaker] ??= []).push(t.text);
  return script;
}

/** Write one WAV per participant per scenario: `<dir>/<scenario>/<Name>.wav`. */
export function writeFixtures(dir: string, scenarios: Scenario[] = SCENARIOS): string[] {
  const written: string[] = [];
  for (const sc of scenarios) {
    const total = scenarioDurationMs(sc);
    mkdirSync(join(dir, sc.id), { recursive: true });
    for (const name of humans(sc)) {
      const file = join(dir, sc.id, `${name}.wav`);
      writeFileSync(
        file,
        writeWav({ sampleRate: FIXTURE_RATE, samples: renderTrack(sc, name, total) }),
      );
      written.push(file);
    }
  }
  return written;
}
