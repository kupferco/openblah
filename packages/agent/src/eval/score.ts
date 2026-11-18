import type { EvalCase } from "./cases.js";

export interface ModelCall {
  name: string;
  /** JSON string, as streamed by the model. */
  args: string;
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** True when the call is what the case expects (tool name and every expected argument). */
export function scoreCall(expected: EvalCase["expect"], calls: ModelCall[]): boolean {
  if (expected.tool === null) return calls.length === 0;
  const call = calls[0];
  if (!call || call.name !== expected.tool) return false;
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(call.args || "{}") as Record<string, unknown>;
  } catch {
    return false;
  }
  return Object.entries(expected.args ?? {}).every(([k, want]) => {
    const got = args[k];
    if (typeof want === "number") return Number(got) === want;
    return typeof got === "string" && norm(got).includes(norm(want));
  });
}

export interface CaseResult {
  id: string;
  ok: boolean;
  /** ms from request to the first tool call chunk (or the end when there is none). */
  toolMs: number;
  /** ms from request to the first streamed chunk. */
  firstMs: number;
  calls: ModelCall[];
  tokens?: number;
  error?: string;
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! : NaN;
};

export interface Summary {
  adapter: string;
  model: string;
  cases: number;
  correct: number;
  accuracy: number;
  accuracyEn: number;
  accuracyPt: number;
  p50ToolMs: number;
  p95ToolMs: number;
  errors: number;
}

export function summarise(
  adapter: string,
  model: string,
  cases: EvalCase[],
  results: CaseResult[],
): Summary {
  const lang = (l: string) => {
    const ids = new Set(cases.filter((c) => c.lang === l).map((c) => c.id));
    const rs = results.filter((r) => ids.has(r.id));
    return rs.length ? rs.filter((r) => r.ok).length / rs.length : NaN;
  };
  const ok = results.filter((r) => r.ok).length;
  const times = results.filter((r) => !r.error).map((r) => r.toolMs);
  return {
    adapter,
    model,
    cases: results.length,
    correct: ok,
    accuracy: results.length ? ok / results.length : NaN,
    accuracyEn: lang("en"),
    accuracyPt: lang("pt"),
    p50ToolMs: pct(times, 50),
    p95ToolMs: pct(times, 95),
    errors: results.filter((r) => r.error).length,
  };
}

const f = (n: number) => (Number.isNaN(n) ? "n/a" : String(Math.round(n)));
const p = (n: number) => (Number.isNaN(n) ? "n/a" : `${Math.round(n * 100)}%`);

/** Markdown table of summaries. */
export function renderResultsTable(rows: Summary[]): string {
  const head =
    "| Adapter | Model | Tool-call accuracy | English | Portuguese | p50 ms to tool call | p95 ms | Errors |\n" +
    "| --- | --- | --- | --- | --- | --- | --- | --- |";
  const body = rows.map(
    (r) =>
      `| ${r.adapter} | ${r.model} | ${p(r.accuracy)} (${r.correct}/${r.cases}) | ${p(r.accuracyEn)} | ${p(r.accuracyPt)} | ${f(r.p50ToolMs)} | ${f(r.p95ToolMs)} | ${r.errors} |`,
  );
  return [head, ...body].join("\n");
}

export const RESULTS_START = "<!-- eval-results:start -->";
export const RESULTS_END = "<!-- eval-results:end -->";

/** Replace the text between the eval markers in a markdown document. */
export function replaceResults(doc: string, block: string): string {
  const a = doc.indexOf(RESULTS_START);
  const b = doc.indexOf(RESULTS_END);
  if (a < 0 || b < a) throw new Error("eval result markers not found in the document");
  return `${doc.slice(0, a + RESULTS_START.length)}\n${block}\n${doc.slice(b)}`;
}
