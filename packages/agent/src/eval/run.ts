import { readFileSync, writeFileSync } from "node:fs";
import { initializeLogger } from "@livekit/agents";
import {
  createLlmProvider,
  createSttProvider,
  createTtsProvider,
  KEY_ENV,
  LLM_PROVIDERS,
  STT_PROVIDERS,
  TTS_PROVIDERS,
} from "../providers/index.js";
import { makeAudio, transcribe, wavPath, wordErrorRate } from "./audio.js";
import { EVAL_CASES } from "./cases.js";
import { startFakeMcp } from "./fake-mcp.js";
import { loadTools, runCase } from "./runner.js";
import { type CaseResult, renderResultsTable, replaceResults, summarise } from "./score.js";
import { existsSync } from "node:fs";

/**
 * `pnpm eval` runs the tool-call eval on every LLM adapter whose key is set and
 * writes the results table to docs/providers.md.
 *
 *   --adapters=openai,claude   only these
 *   --runs=3                   repeat each case (default 1)
 *   --no-write                 print only
 *   --audio                    also: make audio fixtures with each TTS adapter that has a key
 *                              and run them through each STT adapter that has a key
 */
const args = process.argv.slice(2);
const flag = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const env = process.env;
const DOC = new URL("../../../../docs/providers.md", import.meta.url).pathname;

initializeLogger({ pretty: false, level: "error" });

const only = flag("adapters")?.split(",");
const runs = Math.max(1, Number(flag("runs") ?? 1));
const configured = <T extends string>(list: readonly T[]) =>
  list.filter((n) => env[KEY_ENV[n as keyof typeof KEY_ENV]] && (!only || only.includes(n)));

async function evalLlms() {
  const names = configured(LLM_PROVIDERS);
  if (names.length === 0) {
    console.log(
      `No LLM key set (${LLM_PROVIDERS.map((n) => KEY_ENV[n]).join(", ")}); nothing to evaluate.`,
    );
    return;
  }
  const mcp = await startFakeMcp();
  const summaries = [];
  try {
    for (const name of names) {
      const provider = createLlmProvider({ provider: name }, env);
      const model = provider.createLlm();
      const { tools, close } = await loadTools(provider, mcp.url);
      const results: CaseResult[] = [];
      const cases = [];
      for (let i = 0; i < runs; i++) {
        for (const c of EVAL_CASES) {
          const id = runs > 1 ? `${c.id}#${i + 1}` : c.id;
          cases.push({ ...c, id });
          const r = await runCase(model, tools, c);
          results.push({ ...r, id });
          console.log(
            `${name.padEnd(7)} ${id.padEnd(18)} ${r.ok ? "ok  " : "FAIL"} ${Math.round(r.toolMs)} ms` +
              (r.ok
                ? ""
                : `  got ${JSON.stringify(r.calls)}${r.error ? ` error: ${r.error}` : ""}`),
          );
        }
      }
      await close();
      await model.aclose();
      summaries.push(summarise(name, model.model, cases, results));
    }
  } finally {
    await mcp.close();
  }
  const table = renderResultsTable(summaries);
  console.log(`\n${table}\n`);
  if (!args.includes("--no-write")) {
    const stamp = `Run on ${new Date().toISOString().slice(0, 10)}, ${EVAL_CASES.length} cases x ${runs} run(s), latency from request to the first streamed tool call (includes network from this machine).\n\n`;
    writeFileSync(DOC, replaceResults(readFileSync(DOC, "utf8"), stamp + table));
    console.log(`Wrote the table to docs/providers.md`);
  }
}

async function evalAudio() {
  const ttsNames = configured(TTS_PROVIDERS);
  const sttNames = configured(STT_PROVIDERS);
  const ttsName = ttsNames[0];
  if (ttsName && !EVAL_CASES.every((c) => existsSync(wavPath(c.id)))) {
    console.log(`Making audio fixtures with ${ttsName}...`);
    const tts = createTtsProvider({ provider: ttsName }, env);
    for (const c of EVAL_CASES) await makeAudio(tts, c);
  }
  if (!EVAL_CASES.every((c) => existsSync(wavPath(c.id)))) {
    console.log("No audio fixtures and no TTS key to make them; skipping the STT eval.");
    return;
  }
  for (const name of sttNames) {
    const stt = createSttProvider({ provider: name }, env);
    const wers: Record<string, number[]> = { en: [], pt: [] };
    for (const c of EVAL_CASES) {
      const { text, ms } = await transcribe(stt, c);
      const wer = wordErrorRate(c.text, text);
      wers[c.lang]!.push(wer);
      console.log(
        `stt ${name.padEnd(10)} ${c.id.padEnd(16)} WER ${wer.toFixed(2)} ${Math.round(ms)} ms  "${text}"`,
      );
    }
    const mean = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / (xs.length || 1)).toFixed(2);
    console.log(`stt ${name}: mean WER en ${mean(wers.en!)}, pt ${mean(wers.pt!)}`);
  }
}

await evalLlms();
if (args.includes("--audio")) await evalAudio();
process.exit(0);
