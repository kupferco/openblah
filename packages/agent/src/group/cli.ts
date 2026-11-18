/**
 * Offline group replay and classifier eval.
 *
 *   pnpm --filter @openblah/agent group:fixtures [dir]   write the WAV fixtures
 *   pnpm --filter @openblah/agent group:replay [id]      replay scenarios, print transcript + decisions
 *   pnpm --filter @openblah/agent group:eval             score the classifier, modes and facilitation rules on every scenario
 *
 * Scenarios: the T8 set plus the T9 behaviour set (modes, mute, notes, Facilitating rules).
 *
 * Without GEMINI_API_KEY the classifier runs rules only. With it, ambiguous
 * turns go to Gemini Flash through the same `LlmProvider` the agent uses.
 * With DEEPGRAM_API_KEY and `--real-stt` the WAVs go through Deepgram (synthetic
 * tones will not transcribe; use real or TTS-generated recordings for that).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { geminiLlm } from "../providers/gemini.js";
import { deepgramStt } from "../providers/deepgram.js";
import { completerFromProvider, SpeakClassifier } from "./classifier.js";
import { BEHAVIOUR_SCENARIOS, SCENARIOS, writeFixtures } from "./fixtures.js";
import { sttRecognizerFactory } from "./recognizers.js";
import { replayScenario } from "./replay.js";

const [cmd = "replay", ...rest] = process.argv.slice(2);
const flags = rest.filter((a) => a.startsWith("--"));
const args = rest.filter((a) => !a.startsWith("--"));
const env = process.env;
const ALL = [...SCENARIOS, ...BEHAVIOUR_SCENARIOS];

function classifier(): { c: SpeakClassifier; mode: string } {
  if (env.GEMINI_API_KEY) {
    const complete = completerFromProvider(
      geminiLlm({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_CLASSIFIER_MODEL }),
    );
    return { c: new SpeakClassifier({ complete }), mode: "rules + Gemini" };
  }
  return { c: new SpeakClassifier(), mode: "rules only (set GEMINI_API_KEY to add the model)" };
}

async function main(): Promise<void> {
  if (cmd === "fixtures") {
    const dir = resolve(args[0] ?? "fixtures");
    const files = writeFixtures(dir, ALL);
    console.log(`wrote ${files.length} WAV files under ${dir}`);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "openblah-group-"));
  writeFixtures(dir, ALL);
  const { c, mode } = classifier();
  const real = flags.includes("--real-stt") && !!env.DEEPGRAM_API_KEY;
  const selected = cmd === "replay" && args[0] ? ALL.filter((s) => s.id === args[0]) : ALL;
  let ok = 0;
  console.log(`classifier: ${mode}; stt: ${real ? "deepgram" : "scripted"}`);
  for (const sc of selected) {
    const res = await replayScenario(sc, {
      fixturesDir: dir,
      classifier: c,
      recognizer: real
        ? sttRecognizerFactory(deepgramStt({ apiKey: env.DEEPGRAM_API_KEY }))
        : undefined,
    });
    const got = res.last?.decision ?? "none";
    const modeOk = !sc.expectedMode || res.session.behaviour.mode === sc.expectedMode;
    const facOk =
      !sc.expectedFacilitation || res.last?.facilitation?.kind === sc.expectedFacilitation;
    const pass = got === sc.expected && modeOk && facOk;
    if (pass) ok++;
    if (cmd === "replay") {
      console.log(`\n== ${sc.id}: ${sc.description}\n${res.transcript}`);
      for (const d of res.decisions) {
        console.log(`  -> ${d.decision} (${d.source}) after [${d.speaker}]: ${d.reason}`);
      }
    }
    console.log(
      `${pass ? "PASS" : "FAIL"} ${sc.id}: expected ${sc.expected}, got ${got}` +
        (modeOk ? "" : `; mode ${res.session.behaviour.mode}, expected ${sc.expectedMode}`) +
        (facOk ? "" : `; facilitation ${res.last?.facilitation?.kind ?? "none"}`),
    );
  }
  console.log(`\n${ok}/${selected.length} correct`);
  if (cmd === "eval" && ok !== selected.length) process.exitCode = 1;
}

void main();
