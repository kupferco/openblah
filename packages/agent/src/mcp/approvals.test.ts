import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  APPROVAL_DECISION_TOPIC,
  APPROVAL_RESPONSE_TOPIC,
  openMcpRoom,
  parseMcpConfig,
  signWebhook,
  webhookConnection,
  type ActionLogEntry,
  type McpConnection,
  type McpRoom,
  type McpToolInfo,
} from "./index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async (tools: any, name: string, args: object) =>
  tools[name].execute(args, { ctx: {}, toolCallId: "1" });

const bookTool: McpToolInfo = { name: "book_table", description: "Book", inputSchema: {} };
const lookupTool: McpToolInfo = {
  name: "lookup",
  description: "Look up",
  inputSchema: {},
  readOnlyHint: true,
};

interface Rig {
  room: McpRoom;
  entries: ActionLogEntry[];
  calls: string[];
  state: { speaker: string; turns: number };
  hooks: {
    showApproval: Mock;
    resolveApproval: Mock;
    announce: Mock;
  };
}

async function rig(
  config: object = {},
  tools: McpToolInfo[] = [bookTool, lookupTool],
): Promise<Rig> {
  const entries: ActionLogEntry[] = [];
  const calls: string[] = [];
  const state = { speaker: "host-1", turns: 1 };
  const connection: McpConnection = {
    listTools: async () => tools,
    callTool: async (name) => {
      calls.push(name);
      return { isError: false, text: `${name} done` };
    },
    close: async () => {},
  };
  const hooks = {
    currentSpeaker: () => state.speaker,
    sayHold: vi.fn(),
    setWorking: vi.fn(),
    showNote: vi.fn(),
    userTurnCount: () => state.turns,
    showApproval: vi.fn(),
    resolveApproval: vi.fn(),
    announce: vi.fn(),
  };
  const room = await openMcpRoom({
    roomId: "rm_1",
    provider: {},
    config: { servers: [{ id: "s", url: "http://x/mcp" }], ownerId: "host-1", ...config },
    log: { record: (e) => void entries.push(e) },
    hooks,
    connect: async () => connection,
  });
  return { room, entries, calls, state, hooks };
}

describe("write confirmation", () => {
  it("does not execute an unconfirmed write, and read-only tools run freely", async () => {
    const r = await rig();
    const out = await run(r.room.tools, "book_table", { party: 4 });
    expect(out).toContain("Not done yet");
    expect(r.calls).toEqual([]);
    expect(r.hooks.showApproval).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "book table", ownerId: "host-1" }),
    );
    expect(await run(r.room.tools, "lookup", {})).toBe("lookup done");
    expect(r.calls).toEqual(["lookup"]);
  });

  it("runs after the owner confirms by voice, with evidence in the log", async () => {
    const r = await rig();
    await run(r.room.tools, "book_table", { party: 4 });
    r.state.turns = 2; // the owner answered
    const out = await run(r.room.tools, "confirm_pending_action", { approve: true });
    expect(out).toBe("book_table done");
    expect(r.calls).toEqual(["book_table"]);
    const last = r.entries.at(-1)!;
    expect(last.status).toBe("ok");
    expect(last.confirmation).toMatchObject({ via: "voice", by: "host-1" });
    expect(last.confirmation?.summary).toContain("party: 4");
    expect(r.hooks.resolveApproval).not.toHaveBeenCalledWith(expect.anything(), "declined");
  });

  it("does not let the model confirm before the owner has spoken again", async () => {
    const r = await rig();
    await run(r.room.tools, "book_table", {});
    const out = await run(r.room.tools, "confirm_pending_action", { approve: true });
    expect(out).toContain("confirm first");
    expect(r.calls).toEqual([]);
  });

  it("does not run when the owner says no", async () => {
    const r = await rig();
    await run(r.room.tools, "book_table", {});
    r.state.turns = 2;
    await run(r.room.tools, "confirm_pending_action", { approve: false });
    expect(r.calls).toEqual([]);
    expect(r.entries.at(-1)?.status).toBe("declined");
  });

  it("rejects confirmation by a non-owner, by voice and by tap", async () => {
    const r = await rig();
    await run(r.room.tools, "book_table", {});
    const id = (r.hooks.showApproval.mock.calls[0]![0] as { id: string }).id;
    r.state.speaker = "guest-9";
    r.state.turns = 2;
    const out = await run(r.room.tools, "confirm_pending_action", { approve: true });
    expect(out).toContain("whose account");
    await r.room.handleData({
      topic: APPROVAL_RESPONSE_TOPIC,
      payload: JSON.stringify({ approvalId: id, approve: true }),
      sender: "guest-9",
    });
    expect(r.calls).toEqual([]);
    expect(r.entries.filter((e) => e.status === "denied")).toHaveLength(2);
    // The owner can still confirm afterwards.
    await r.room.handleData({
      topic: APPROVAL_RESPONSE_TOPIC,
      payload: JSON.stringify({ approvalId: id, approve: true }),
      sender: "host-1",
    });
    expect(r.calls).toEqual(["book_table"]);
    expect(r.entries.at(-1)?.confirmation).toMatchObject({ via: "tap", by: "host-1" });
    expect(r.hooks.announce).toHaveBeenCalledWith("book_table done");
  });

  it("accepts server-forwarded decisions only from the server, and checks the actor", async () => {
    const r = await rig();
    await run(r.room.tools, "book_table", {});
    const id = (r.hooks.showApproval.mock.calls[0]![0] as { id: string }).id;
    const payload = JSON.stringify({ approvalId: id, approve: true, actorUserId: "host-1" });
    // Forged by a participant: ignored.
    await r.room.handleData({ topic: APPROVAL_DECISION_TOPIC, payload, sender: "guest-9" });
    expect(r.calls).toEqual([]);
    // From the server but for the wrong actor: rejected.
    await r.room.handleData({
      topic: APPROVAL_DECISION_TOPIC,
      payload: JSON.stringify({ approvalId: id, approve: true, actorUserId: "guest-9" }),
    });
    expect(r.calls).toEqual([]);
    await r.room.handleData({ topic: APPROVAL_DECISION_TOPIC, payload });
    expect(r.calls).toEqual(["book_table"]);
  });

  it("lets the host override read/write per tool", async () => {
    const r = await rig({ toolOverrides: { book_table: "read", lookup: "write" } });
    expect(await run(r.room.tools, "book_table", {})).toBe("book_table done");
    expect(await run(r.room.tools, "lookup", {})).toContain("Not done yet");
  });

  it("only the owner can start a write", async () => {
    const r = await rig();
    r.state.speaker = "guest-9";
    await run(r.room.tools, "book_table", {});
    expect(r.hooks.showApproval).not.toHaveBeenCalled();
    expect(r.entries[0]?.status).toBe("denied");
  });
});

describe("webhook tools", () => {
  let http: Server;
  let url: string;
  let last: { headers: Record<string, unknown>; body: string } | undefined;
  let mode: "ok" | "slow" | "fail" = "ok";
  beforeAll(async () => {
    http = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        last = { headers: req.headers, body };
        if (mode === "slow") return; // never answers
        res.statusCode = mode === "fail" ? 500 : 200;
        res.end(JSON.stringify({ text: "sent" }));
      });
    });
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/hook`;
  });
  afterAll(() => {
    http.closeAllConnections();
    http.close();
  });
  beforeEach(() => {
    mode = "ok";
    last = undefined;
  });

  const tool = () => ({
    name: "send_sms",
    description: "Send a text",
    inputSchema: { type: "object", properties: { to: { type: "string" } } },
    url,
    secret: "s3cret",
    timeoutMs: 100,
  });

  it("signs the request with an HMAC the receiver can verify", async () => {
    const conn = webhookConnection(tool(), { roomId: "rm_1" });
    const res = await conn.callTool("send_sms", { to: "x" }, { approvalId: "ap1" });
    expect(res).toEqual({ isError: false, text: "sent" });
    const ts = String(last!.headers["x-openblah-timestamp"]);
    expect(last!.headers["x-openblah-signature"]).toBe(signWebhook("s3cret", ts, last!.body));
    expect(last!.headers["x-openblah-signature"]).not.toBe(signWebhook("other", ts, last!.body));
    expect(JSON.parse(last!.body)).toEqual({
      tool: "send_sms",
      arguments: { to: "x" },
      roomId: "rm_1",
      approvalId: "ap1",
    });
  });

  it("times out and reports an error", async () => {
    mode = "slow";
    const conn = webhookConnection(tool(), { roomId: "rm_1" });
    await expect(conn.callTool("send_sms", {})).rejects.toThrow("timed out");
  });

  it("does not leak the secret on failure", async () => {
    mode = "fail";
    const conn = webhookConnection(tool(), { roomId: "rm_1" });
    const res = await conn.callTool("send_sms", {});
    expect(res.isError).toBe(true);
    expect(res.text).not.toContain("s3cret");
  });

  it("needs confirmation like any write, and logs the timeout", async () => {
    const entries: ActionLogEntry[] = [];
    let turns = 1;
    const hooks = {
      currentSpeaker: () => "host-1",
      sayHold: vi.fn(),
      setWorking: vi.fn(),
      showNote: vi.fn(),
      userTurnCount: () => turns,
      showApproval: vi.fn(),
      resolveApproval: vi.fn(),
      announce: vi.fn(),
    };
    mode = "slow";
    const room = await openMcpRoom({
      roomId: "rm_1",
      provider: {},
      config: { servers: [], ownerId: "host-1", webhookTools: [tool()] },
      log: { record: (e) => void entries.push(e) },
      hooks,
    });
    await run(room.tools, "send_sms", { to: "x" });
    expect(last).toBeUndefined(); // not called before confirmation
    turns = 2;
    const out = await run(room.tools, "confirm_pending_action", { approve: true });
    expect(out).toContain("did not work");
    expect(entries.at(-1)).toMatchObject({ status: "error", detail: "webhook timed out" });
    expect(entries.at(-1)?.confirmation?.via).toBe("voice");
    expect(JSON.stringify(entries)).not.toContain("s3cret");
  });

  it("validates webhook config from job metadata", () => {
    const good = { ...tool(), url: "https://example.com/h" };
    const cfg = parseMcpConfig(
      JSON.stringify({
        mcp: {
          webhookTools: [good, { ...good, url: "http://evil.example/h" }, { ...good, secret: "" }],
        },
      }),
    );
    expect(cfg?.webhookTools).toHaveLength(1);
  });
});
