import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { initializeLogger, llm } from "@livekit/agents";
import { afterAll, describe, expect, it } from "vitest";
import { claudeLlm } from "./anthropic.js";
import { type FakeVendor, startFakeVendor, type Vendor } from "./fake-vendors.js";
import { geminiLlm } from "./gemini.js";
import { openaiLlm } from "./openai.js";
import {
  createLlmProvider,
  createSttProvider,
  createTtsProvider,
  LLM_PROVIDERS,
  parseProviderChoice,
  parseRoomProviders,
  providersFromLevels,
  resolveProviderChoice,
  STT_PROVIDERS,
  TTS_PROVIDERS,
} from "./select.js";
import type { LlmProvider } from "./types.js";

initializeLogger({ pretty: false, level: "silent" });

/** An MCP-style tool schema with the keywords that differ between vendors. */
const MCP_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: {
    city: { type: "string", description: "City name" },
    days: { type: ["integer", "null"], exclusiveMinimum: 0 },
  },
  required: ["city"],
  additionalProperties: false,
};

const ADAPTERS: Array<{ name: string; vendor: Vendor; make: (baseUrl: string) => LlmProvider }> = [
  { name: "gemini", vendor: "gemini", make: (baseUrl) => geminiLlm({ apiKey: "k", baseUrl }) },
  { name: "openai", vendor: "openai", make: (baseUrl) => openaiLlm({ apiKey: "k", baseUrl }) },
  { name: "claude", vendor: "anthropic", make: (baseUrl) => claudeLlm({ apiKey: "k", baseUrl }) },
];

function chatArgs(provider: LlmProvider) {
  const chatCtx = llm.ChatContext.empty();
  chatCtx.addMessage({ role: "system", content: "You are a voice assistant." });
  chatCtx.addMessage({ role: "user", content: "What is the weather in Lisbon?" });
  const toolCtx = {
    get_weather: llm.tool({
      description: "Weather for a city",
      parameters: (provider.formatToolSchema?.(MCP_SCHEMA) ?? MCP_SCHEMA) as never,
      execute: async () => "sunny",
    }),
  };
  return { chatCtx, toolCtx: toolCtx as never };
}

/** Every LLM adapter must pass this: the LlmProvider contract. */
describe.each(ADAPTERS)("LlmProvider contract: $name", ({ name, vendor, make }) => {
  const fakes: FakeVendor[] = [];
  afterAll(() => Promise.all(fakes.map((f) => f.close())));

  it("has a name and builds an llm.LLM", async () => {
    const fake = await startFakeVendor(vendor);
    fakes.push(fake);
    const provider = make(fake.baseUrl);
    expect(provider.name).toBe(name);
    const model = provider.createLlm();
    expect(typeof model.chat).toBe("function");
    expect(model.model).toBeTruthy();
    await model.aclose();
  });

  it("converts an MCP schema to a valid object schema", () => {
    const out = make("http://unused").formatToolSchema!(MCP_SCHEMA);
    expect(out.type).toBe("object");
    expect(out.required).toEqual(["city"]);
    expect(out).not.toHaveProperty("$schema");
    expect(Object.keys(out.properties as object)).toEqual(["city", "days"]);
    // Empty input schema still gives an object.
    expect(make("http://unused").formatToolSchema!({})).toMatchObject({
      type: "object",
      properties: {},
    });
  });

  it("streams a tool call with usage", async () => {
    const fake = await startFakeVendor(vendor);
    fakes.push(fake);
    const provider = make(fake.baseUrl);
    const model = provider.createLlm();
    const res = await model.chat(chatArgs(provider)).collect();
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]!.name).toBe("get_weather");
    expect(JSON.parse(res.toolCalls[0]!.args)).toEqual({ city: "Lisbon" });
    expect(res.usage?.totalTokens).toBeGreaterThan(0);
    // The tool and the user's words reached the vendor.
    const sent = JSON.stringify(fake.requests[0]!.body);
    expect(sent).toContain("get_weather");
    expect(sent).toContain("Lisbon");
    await model.aclose();
  });

  it("can be cancelled mid-stream", async () => {
    const fake = await startFakeVendor(vendor, true);
    fakes.push(fake);
    const provider = make(fake.baseUrl);
    const model = provider.createLlm();
    const stream = model.chat(chatArgs(provider));
    const drained = (async () => {
      // Nothing to do per chunk: the server never finishes.
      while (!(await stream.next()).done);
    })();
    await new Promise((r) => setTimeout(r, 300));
    stream.close();
    await Promise.race([
      drained,
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("cancel did not end the stream")), 3000),
      ),
    ]);
    await model.aclose();
  });
});

describe("provider selection", () => {
  it("has an adapter for every listed name, for LLM, STT and TTS", () => {
    for (const p of LLM_PROVIDERS) expect(createLlmProvider({ provider: p }, {}).name).toBe(p);
    for (const p of STT_PROVIDERS) expect(createSttProvider({ provider: p }, {}).name).toBe(p);
    for (const p of TTS_PROVIDERS) {
      const t = createTtsProvider({ provider: p }, {});
      expect(t.name).toBe(p);
      expect(typeof t.setLanguage).toBe("function");
    }
  });

  it("resolves room, then user/product, then server default, then Gemini/Deepgram/Cartesia", () => {
    expect(resolveProviderChoice({}).llm.provider).toBe("gemini");
    expect(resolveProviderChoice({ server: { llm: { provider: "openai" } } }).llm.provider).toBe(
      "openai",
    );
    const both = {
      server: { llm: { provider: "openai" as const } },
      user: { llm: { provider: "claude" as const, model: "m1" } },
    };
    expect(resolveProviderChoice(both).llm).toEqual({ provider: "claude", model: "m1" });
    expect(
      resolveProviderChoice({ ...both, room: { llm: { provider: "gemini" } } }).llm.provider,
    ).toBe("gemini");
    // Parts resolve independently.
    const mixed = resolveProviderChoice({
      room: { tts: { provider: "elevenlabs" } },
      user: { llm: { provider: "claude" } },
      server: { stt: { provider: "assemblyai" } },
    });
    expect([mixed.llm.provider, mixed.stt.provider, mixed.tts.provider]).toEqual([
      "claude",
      "assemblyai",
      "elevenlabs",
    ]);
  });

  it("reads the room level from job metadata and ignores unknown providers", () => {
    expect(
      parseRoomProviders(JSON.stringify({ providers: { llm: { provider: "openai" } } })),
    ).toEqual({ llm: { provider: "openai" } });
    expect(parseRoomProviders(JSON.stringify({ providers: { llm: { provider: "evil" } } }))).toBe(
      undefined,
    );
    expect(parseRoomProviders("not json")).toBeUndefined();
    expect(parseProviderChoice({ tts: { provider: "openai", voice: "nova" } })).toEqual({
      tts: { provider: "openai", voice: "nova" },
    });
  });

  it("builds providers from the three levels and the server env", () => {
    const set = providersFromLevels(
      { room: { llm: { provider: "claude" } } },
      { OPENBLAH_TTS_PROVIDER: "elevenlabs", OPENBLAH_STT_PROVIDER: "openai" },
    );
    expect([set.llm.name, set.stt.name, set.tts.name]).toEqual(["claude", "openai", "elevenlabs"]);
  });
});

describe("vendor SDKs stay inside the adapters", () => {
  // Agent loop, "should I speak?" classifier and notes must use LlmProvider only.
  const VENDOR =
    /from\s+["'](openai|@anthropic-ai\/sdk|@google\/genai|@google\/generative-ai|@livekit\/agents-plugin-(openai|anthropic|google|elevenlabs|assemblyai|deepgram|cartesia))["']/;
  const root = new URL("..", import.meta.url).pathname;
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );

  it("no file outside src/providers imports a vendor SDK or plugin", () => {
    const offenders = walk(root)
      .filter((f) => f.endsWith(".ts") && !f.includes("/providers/"))
      .filter((f) => VENDOR.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
