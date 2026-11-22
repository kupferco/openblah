import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { int16ToPcm, pcmToInt16 } from "./watch-link.js";
import { attachWatchSocket, WATCH_SOCKET_PATH } from "./watch-socket.js";
import { signWatchTicket, type RoomLink, type RoomLinkHandlers } from "./watch.js";

const SECRET = "s";
let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

async function setup(opts: { idleMs?: number } = {}) {
  const published: Uint8Array[] = [];
  const link: RoomLink = {
    publishAudio: (p) => published.push(p),
    setMuted: vi.fn(),
    close: vi.fn(async () => {}),
  };
  let handlers!: RoomLinkHandlers;
  const connect = vi.fn(async (_c: unknown, h: RoomLinkHandlers) => {
    handlers = h;
    return link;
  });
  server = createServer((_q, res) => res.end("ok"));
  attachWatchSocket(server, { secret: SECRET, connect, agentName: async () => "Blah", ...opts });
  await new Promise<void>((r) => server!.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  const open = (path = WATCH_SOCKET_PATH) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    const texts: Record<string, unknown>[] = [];
    const bins: Buffer[] = [];
    ws.on("message", (d, isBinary) =>
      isBinary ? bins.push(d as Buffer) : texts.push(JSON.parse(String(d))),
    );
    const opened = new Promise<void>((res, rej) => {
      ws.on("open", res);
      ws.on("error", rej);
    });
    return { ws, texts, bins, opened };
  };
  const ticket = () => signWatchTicket(SECRET, { uid: "u1", roomId: "rm_1", displayName: "Ana" });
  return { open, ticket, link, connect, published, handlers: () => handlers };
}

describe("watch socket", () => {
  it("runs a session: start, audio both ways, state, transcript, mute, stop", async () => {
    const t = await setup();
    const c = t.open();
    await c.opened;
    c.ws.send(JSON.stringify({ type: "start", version: 1, ticket: await t.ticket() }));
    await vi.waitFor(() =>
      expect(c.texts[0]).toMatchObject({ type: "started", agentName: "Blah" }),
    );
    c.ws.send(Buffer.from([1, 0, 2, 0]), { binary: true }); // arrives after start finished
    await vi.waitFor(() => expect(t.published).toHaveLength(1));
    t.handlers().onAudio(new Uint8Array([9, 9]));
    t.handlers().onAgentState("speaking");
    t.handlers().onTranscript("Blah", "Hi", true);
    c.ws.send(JSON.stringify({ type: "mute", muted: true }));
    await vi.waitFor(() =>
      expect(c.texts.map((m) => m.type)).toEqual(["started", "agent_state", "transcript", "muted"]),
    );
    expect(c.bins[0]).toEqual(Buffer.from([9, 9]));
    c.ws.send(JSON.stringify({ type: "stop" }));
    await vi.waitFor(() => expect(c.texts.at(-1)).toEqual({ type: "stopped", reason: "client" }));
    await vi.waitFor(() => expect(t.link.close).toHaveBeenCalled());
  });

  it("rejects a bad ticket and closes", async () => {
    const t = await setup();
    const c = t.open();
    await c.opened;
    c.ws.send(JSON.stringify({ type: "start", version: 1, ticket: "bad" }));
    await new Promise((r) => c.ws.on("close", r));
    expect(c.texts[0]).toMatchObject({ type: "error", code: "unauthorized" });
    expect(t.connect).not.toHaveBeenCalled();
  });

  it("leaves the room when the socket drops", async () => {
    const t = await setup();
    const c = t.open();
    await c.opened;
    c.ws.send(JSON.stringify({ type: "start", version: 1, ticket: await t.ticket() }));
    await vi.waitFor(() => expect(c.texts[0]).toMatchObject({ type: "started" }));
    c.ws.terminate();
    await vi.waitFor(() => expect(t.link.close).toHaveBeenCalled());
  });

  it("drops an idle socket", async () => {
    const t = await setup({ idleMs: 50 });
    const c = t.open();
    await c.opened;
    await new Promise((r) => c.ws.on("close", r));
  });

  it("does not upgrade other paths", async () => {
    const t = await setup();
    const c = t.open("/other");
    await expect(c.opened).rejects.toBeDefined();
  });
});

describe("pcm helpers", () => {
  it("round-trips little-endian 16-bit samples, including unaligned views", () => {
    const s = new Int16Array([0, 1, -1, 32767, -32768]);
    expect(Array.from(pcmToInt16(int16ToPcm(s)))).toEqual(Array.from(s));
    const buf = new Uint8Array([0, ...int16ToPcm(s)]).subarray(1);
    expect(Array.from(pcmToInt16(buf))).toEqual(Array.from(s));
    expect(pcmToInt16(new Uint8Array([1])).length).toBe(0);
  });
});
