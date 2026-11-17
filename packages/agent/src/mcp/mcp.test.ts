import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { geminiToolSchema } from "../providers/gemini.js";
import {
  type ActionLogEntry,
  buildMcpTools,
  connectMcp,
  openMcpRoom,
  parseMcpConfig,
  summariseForSpeech,
} from "./index.js";

let http: Server;
let url: string;
let lastAuth: string | undefined;
const writes: string[] = [];

beforeAll(async () => {
  http = createServer(async (req, res) => {
    lastAuth = req.headers.authorization;
    const server = new McpServer({ name: "fake", version: "1.0.0" });
    server.registerTool(
      "get_weather",
      {
        description: "Weather for a city",
        inputSchema: { city: z.string() },
        annotations: { readOnlyHint: true },
      },
      async ({ city }) => ({ content: [{ type: "text", text: `Sunny in ${city}` }] }),
    );
    server.registerTool(
      "dump",
      { description: "Long result", annotations: { readOnlyHint: true } },
      async () => ({ content: [{ type: "text", text: "x".repeat(1000) }] }),
    );
    server.registerTool("book_table", { description: "Book a table" }, async () => {
      writes.push("booked");
      return { content: [{ type: "text", text: "booked" }] };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => void transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
});
afterAll(() => void http.close());

function setup(speaker = "host-1", allowTools?: string[]) {
  const entries: ActionLogEntry[] = [];
  const hooks = {
    currentSpeaker: () => speaker,
    sayHold: vi.fn(),
    setWorking: vi.fn(),
    showNote: vi.fn(),
  };
  const config = {
    servers: [{ id: "demo", url, userToken: "tok-123" }],
    ownerId: "host-1",
    allowTools,
  };
  return { entries, hooks, config, log: { record: (e: ActionLogEntry) => void entries.push(e) } };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async (tools: any, name: string, args: object) =>
  tools[name].execute(args, { ctx: {}, toolCallId: "1" });

describe("MCP client in the agent", () => {
  it("answers via a read-only tool, sends the user token, and logs the action", async () => {
    const s = setup();
    const room = await openMcpRoom({ roomId: "rm_1", provider: {}, ...s });
    expect(Object.keys(room.tools).sort()).toEqual(["book_table", "dump", "get_weather"]);
    const out = await run(room.tools, "get_weather", { city: "Lisbon" });
    expect(out).toBe("Sunny in Lisbon");
    expect(lastAuth).toBe("Bearer tok-123");
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({
      roomId: "rm_1",
      askedBy: "host-1",
      ownerId: "host-1",
      tool: "get_weather",
      arguments: { city: "Lisbon" },
      status: "ok",
    });
    expect(JSON.stringify(s.entries)).not.toContain("tok-123");
    await room.close();
  });

  it("blocks tools that change something or are unknown", async () => {
    const s = setup();
    const room = await openMcpRoom({ roomId: "rm_1", provider: {}, ...s });
    await run(room.tools, "book_table", {});
    expect(writes).toEqual([]);
    expect(s.entries[0]?.status).toBe("blocked");
    await room.close();
  });

  it("refuses when someone other than the connection owner asks", async () => {
    const s = setup("guest-9");
    const room = await openMcpRoom({ roomId: "rm_1", provider: {}, ...s });
    await run(room.tools, "get_weather", { city: "Porto" });
    expect(s.entries[0]).toMatchObject({ status: "denied", askedBy: "guest-9", ownerId: "host-1" });
    await room.close();
  });

  it("applies the host allow-list", async () => {
    const s = setup("host-1", ["get_weather"]);
    const room = await openMcpRoom({ roomId: "rm_1", provider: {}, ...s });
    expect(Object.keys(room.tools)).toEqual(["get_weather"]);
    await room.close();
  });

  it("sends long results to the screen and not into speech", async () => {
    const s = setup();
    const room = await openMcpRoom({ roomId: "rm_1", provider: {}, ...s });
    const out = await run(room.tools, "dump", {});
    expect(out).not.toContain("xxxx");
    expect(s.hooks.showNote).toHaveBeenCalledWith(expect.objectContaining({ title: "dump" }));
    await room.close();
  });

  it("holds and shows working state for slow tools", async () => {
    const s = setup();
    const connection = await connectMcp(url);
    const slow = {
      ...connection,
      callTool: async (n: string, a: Record<string, unknown>) => {
        await new Promise((r) => setTimeout(r, 60));
        return connection.callTool(n, a);
      },
    };
    const tools = buildMcpTools({
      roomId: "rm_1",
      config: s.config,
      provider: {},
      log: s.log,
      hooks: s.hooks,
      slowMs: 10,
      servers: [
        { id: "demo", ownerId: "host-1", connection: slow, tools: await connection.listTools() },
      ],
    });
    await run(tools, "get_weather", { city: "Rio" });
    expect(s.hooks.sayHold).toHaveBeenCalledOnce();
    expect(s.hooks.setWorking).toHaveBeenNthCalledWith(1, true, "get weather");
    expect(s.hooks.setWorking).toHaveBeenLastCalledWith(false);
    await connection.close();
  });
});

describe("helpers", () => {
  it("parses room config from job metadata", () => {
    expect(parseMcpConfig(undefined)).toBeUndefined();
    expect(parseMcpConfig("nope")).toBeUndefined();
    expect(
      parseMcpConfig(JSON.stringify({ mcp: { servers: [{ id: "a", url: "file:///x" }] } })),
    ).toBeUndefined();
    const cfg = parseMcpConfig(
      JSON.stringify({
        mcp: { servers: [{ id: "a", url: "https://x/mcp" }], allowTools: ["t"], ownerId: "h" },
      }),
    );
    expect(cfg).toMatchObject({ allowTools: ["t"], ownerId: "h" });
  });
  it("summarises long text and keeps short text", () => {
    expect(summariseForSpeech("hi  there").spoken).toBe("hi there");
    expect(summariseForSpeech("y".repeat(500)).long).toBe(true);
  });
  it("converts schemas for Gemini", () => {
    const out = geminiToolSchema({
      $schema: "x",
      type: "object",
      additionalProperties: false,
      properties: {
        a: { type: ["string", "null"], const: 1 },
        additionalProperties: { type: "number" },
      },
    });
    expect(out).toEqual({
      type: "object",
      properties: { a: { type: "string" }, additionalProperties: { type: "number" } },
    });
  });
});
