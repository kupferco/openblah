import { initializeLogger } from "@livekit/agents";
import { afterAll, describe, expect, it } from "vitest";
import { startFakeVendor } from "../providers/fake-vendors.js";
import { openaiLlm } from "../providers/openai.js";
import { wordErrorRate } from "./audio.js";
import { EVAL_CASES } from "./cases.js";
import { startFakeMcp } from "./fake-mcp.js";
import { loadTools, runCase } from "./runner.js";
import {
  RESULTS_END,
  RESULTS_START,
  renderResultsTable,
  replaceResults,
  scoreCall,
  summarise,
} from "./score.js";

initializeLogger({ pretty: false, level: "silent" });

describe("eval set", () => {
  it("has English and Portuguese cases with unique ids", () => {
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
    for (const lang of ["en", "pt"]) {
      expect(EVAL_CASES.filter((c) => c.lang === lang).length).toBeGreaterThanOrEqual(5);
    }
    expect(EVAL_CASES.some((c) => c.expect.tool === null)).toBe(true);
  });

  it("scores tool name and arguments, ignoring case and accents", () => {
    const want = { tool: "get_weather", args: { city: "São Paulo" } };
    expect(scoreCall(want, [{ name: "get_weather", args: '{"city":"sao paulo"}' }])).toBe(true);
    expect(scoreCall(want, [{ name: "get_weather", args: '{"city":"Rio"}' }])).toBe(false);
    expect(scoreCall(want, [{ name: "other", args: '{"city":"São Paulo"}' }])).toBe(false);
    expect(scoreCall(want, [])).toBe(false);
    expect(scoreCall({ tool: null }, [])).toBe(true);
    expect(scoreCall({ tool: null }, [{ name: "x", args: "{}" }])).toBe(false);
    expect(
      scoreCall({ tool: "c", args: { amount: 50 } }, [{ name: "c", args: '{"amount":"50"}' }]),
    ).toBe(true);
  });

  it("computes word error rate", () => {
    expect(wordErrorRate("what is the weather", "What is the weather?")).toBe(0);
    expect(wordErrorRate("what is the weather", "what is weather")).toBe(0.25);
  });

  it("renders the table and replaces the marked block", () => {
    const table = renderResultsTable([
      summarise("x", "m", EVAL_CASES.slice(0, 2), [
        { id: EVAL_CASES[0]!.id, ok: true, toolMs: 100, firstMs: 50, calls: [] },
        { id: EVAL_CASES[1]!.id, ok: false, toolMs: 300, firstMs: 80, calls: [] },
      ]),
    ]);
    expect(table).toContain("| x | m | 50% (1/2)");
    const doc = `a\n${RESULTS_START}\nold\n${RESULTS_END}\nb`;
    expect(replaceResults(doc, table)).toBe(`a\n${RESULTS_START}\n${table}\n${RESULTS_END}\nb`);
    expect(() => replaceResults("no markers", table)).toThrow();
  });
});

describe("eval runner against fakes", () => {
  const closers: Array<() => Promise<void>> = [];
  afterAll(() => Promise.all(closers.map((c) => c())));

  it("lists the fake MCP tools through the adapter and times a streamed tool call", async () => {
    const mcp = await startFakeMcp();
    const vendor = await startFakeVendor("openai");
    closers.push(mcp.close, vendor.close);
    const provider = openaiLlm({ apiKey: "k", baseUrl: vendor.baseUrl });
    const { tools, close } = await loadTools(provider, mcp.url);
    const model = provider.createLlm();
    const weather = EVAL_CASES.find((c) => c.id === "en-weather")!;
    // The fake vendor always asks for get_weather in Lisbon, which is this case's answer.
    const ok = await runCase(model, tools, weather);
    expect(ok).toMatchObject({ ok: true });
    expect(ok.toolMs).toBeGreaterThanOrEqual(0);
    const wrong = await runCase(
      model,
      tools,
      EVAL_CASES.find((c) => c.id === "en-smalltalk")!,
    );
    expect(wrong.ok).toBe(false);
    const sent = JSON.stringify(vendor.requests[0]!.body);
    for (const t of [
      "get_weather",
      "list_events",
      "find_restaurants",
      "get_stock_price",
      "convert_currency",
    ]) {
      expect(sent).toContain(t);
    }
    await close();
    await model.aclose();
  });
});
