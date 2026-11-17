import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { connectMcp, type McpConnection } from "./mcp/index.js";
import { languageFromMetadata, settingsTools } from "./settings.js";
import { DirectAgent } from "./pipeline.js";

/*
 * A stand-in for the OpenBlah server's settings MCP tool (the real one is tested in the server
 * package): same three tools, same two-step rule, reached over real MCP HTTP.
 */
let http: Server;
let url: string;
const state = { llm: "gemini", pendingToken: "", changes: 0 };
const seen: Record<string, unknown>[] = [];

beforeAll(async () => {
  http = createServer(async (req, res) => {
    const server = new McpServer({ name: "settings", version: "1.0.0" });
    const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
    const ids = { roomId: z.string(), actorUserId: z.string() };
    server.registerTool("get_settings", { inputSchema: ids }, async (a) => {
      seen.push(a);
      return text(
        JSON.stringify({ llm: { provider: state.llm }, language: "auto", agentName: "Blah" }),
      );
    });
    server.registerTool(
      "propose_settings_change",
      { inputSchema: { ...ids, llm: z.string().optional() } },
      async (a) => {
        seen.push(a);
        state.pendingToken = `tok-${a.llm}`;
        return text(
          JSON.stringify({
            status: "needs_confirmation",
            question: `Do you want me to switch the model to ${a.llm}?`,
            confirmationToken: state.pendingToken,
          }),
        );
      },
    );
    server.registerTool(
      "confirm_settings_change",
      { inputSchema: { ...ids, confirmationToken: z.string() } },
      async (a) => {
        seen.push(a);
        if (a.confirmationToken !== state.pendingToken) {
          return { ...text("not valid"), isError: true };
        }
        state.llm = a.confirmationToken.slice(4);
        state.changes += 1;
        return text(
          JSON.stringify({ status: "changed", changed: `switch the model to ${state.llm}` }),
        );
      },
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => void transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${address(http).port}/mcp/settings`;
});
afterAll(() => void http.close());
const address = (s: Server) => s.address() as AddressInfo;

/** A fixture conversation: each `say` is one finished user turn by one speaker. */
function conversation(connection: Pick<McpConnection, "callTool">) {
  let turn = 0;
  let speaker = "host-1";
  const tools = settingsTools({
    roomId: "rm_1",
    connection,
    currentSpeaker: () => speaker,
    turn: () => turn,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = (name: keyof typeof tools, args: object = {}) =>
    (tools[name] as any).execute(args, { ctx: {}, toolCallId: "1" }) as Promise<string>;
  return {
    say: (who: string) => {
      speaker = who;
      turn += 1;
    },
    run,
  };
}

let connection: McpConnection;
beforeEach(async () => {
  state.llm = "gemini";
  state.pendingToken = "";
  state.changes = 0;
  seen.length = 0;
  connection = await connectMcp(url, "secret");
});

describe("settings by voice", () => {
  it("'switch to Claude' triggers a confirmation, and 'yes' then changes the setting", async () => {
    const c = conversation(connection);
    c.say("host-1"); // "switch to Claude"
    const ask = await c.run("change_settings", { llm: "claude" });
    expect(ask).toMatch(/Nothing has changed yet/);
    expect(ask).toMatch(/switch the model to claude/);
    expect(state.llm).toBe("gemini");

    c.say("host-1"); // "yes"
    const done = await c.run("confirm_settings_change");
    expect(done).toMatch(/Done/);
    expect(state.llm).toBe("claude");
    expect(state.changes).toBe(1);
    // The server is told who asked and which room, from the agent's side, not from the model.
    expect(seen.at(-1)).toMatchObject({ roomId: "rm_1", actorUserId: "host-1" });
  });

  it("refuses to confirm in the same turn as the request", async () => {
    const c = conversation(connection);
    c.say("host-1");
    await c.run("change_settings", { llm: "claude" });
    const early = await c.run("confirm_settings_change");
    expect(early).toMatch(/Not yet/);
    expect(state.changes).toBe(0);
    expect(state.llm).toBe("gemini");
  });

  it("changes nothing until a confirmation is called", async () => {
    const c = conversation(connection);
    c.say("host-1");
    await c.run("change_settings", { llm: "openai" });
    c.say("host-1"); // "no, leave it"
    expect(state.changes).toBe(0);
  });

  it("only the person who asked can confirm", async () => {
    const c = conversation(connection);
    c.say("host-1");
    await c.run("change_settings", { llm: "claude" });
    c.say("guest-2"); // someone else says "yes"
    expect(await c.run("confirm_settings_change")).toMatch(/Only the person who asked/);
    expect(state.changes).toBe(0);
  });

  it("a new request replaces the pending one, and nothing pending means no change", async () => {
    const c = conversation(connection);
    c.say("host-1");
    expect(await c.run("confirm_settings_change")).toMatch(/nothing waiting/);
    await c.run("change_settings", { llm: "claude" });
    await c.run("change_settings", { llm: "openai" });
    c.say("host-1");
    await c.run("confirm_settings_change");
    expect(state.llm).toBe("openai");
    c.say("host-1");
    expect(await c.run("confirm_settings_change")).toMatch(/nothing waiting/);
  });

  it("reads the current setting aloud", async () => {
    const c = conversation(connection);
    c.say("host-1");
    expect(await c.run("get_settings")).toBe(
      "The model is gemini, the language is automatic, and my name is Blah.",
    );
  });

  it("fails politely when the settings cannot be reached", async () => {
    const c = conversation({
      callTool: async () => {
        throw new Error("down");
      },
    });
    c.say("host-1");
    expect(await c.run("change_settings", { llm: "claude" })).toMatch(/could not reach/);
  });
});

describe("room language override", () => {
  it("reads it from the job metadata", () => {
    expect(languageFromMetadata('{"language":"pt"}')).toBe("pt");
    expect(languageFromMetadata('{"language":"fr"}')).toBeUndefined();
    expect(languageFromMetadata("nope")).toBeUndefined();
    expect(languageFromMetadata(undefined)).toBeUndefined();
  });

  it("a locked language is not changed by what people speak", () => {
    const agent = new DirectAgent({ agentName: "Blah" }, { setLanguage: () => {} } as never);
    agent.lockLanguage("pt");
    expect(agent.applyLanguage("what is the weather like today in the city")).toBe("pt");
    agent.lockLanguage(undefined);
    expect(agent.applyLanguage("what is the weather like today in the city")).toBe("en");
  });
});
