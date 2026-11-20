import { describe, expect, it, vi } from "vitest";
import { createApp, MemoryStorage } from "./index.js";
import type { LiveKitGateway, RoomLink, RoomLinkHandlers, WatchServerMessage } from "./index.js";
import {
  parseClientMessage,
  signWatchTicket,
  verifyWatchTicket,
  WatchSession,
  WATCH_PROTOCOL_VERSION,
} from "./watch.js";

const SECRET = "watch-secret";
const claims = { uid: "u1", roomId: "rm_1", displayName: "Ana" };

function session() {
  const sent: WatchServerMessage[] = [];
  const audio: Uint8Array[] = [];
  const closed = vi.fn();
  let handlers!: RoomLinkHandlers;
  const link: RoomLink = {
    publishAudio: vi.fn(),
    setMuted: vi.fn(),
    close: vi.fn(async () => {}),
  };
  const connect = vi.fn(async (_c: unknown, h: RoomLinkHandlers) => {
    handlers = h;
    return link;
  });
  const s = new WatchSession(
    { sendText: (m) => sent.push(m), sendAudio: (a) => audio.push(a), close: closed },
    SECRET,
    connect,
    async () => "Blah",
  );
  return { s, sent, audio, closed, link, connect, handlers: () => handlers };
}
const start = async (ticket?: string, version = WATCH_PROTOCOL_VERSION) =>
  JSON.stringify({
    type: "start",
    version,
    ticket: ticket ?? (await signWatchTicket(SECRET, claims)),
  });

describe("watch protocol parsing", () => {
  it("accepts the three client messages and rejects the rest", () => {
    expect(parseClientMessage('{"type":"stop"}')).toEqual({ type: "stop" });
    expect(parseClientMessage('{"type":"mute","muted":true}')).toEqual({
      type: "mute",
      muted: true,
    });
    expect(parseClientMessage('{"type":"mute","muted":"yes"}')).toBeNull();
    expect(parseClientMessage('{"type":"start","version":1}')).toBeNull();
    expect(parseClientMessage("nope")).toBeNull();
    expect(parseClientMessage("x".repeat(5000))).toBeNull();
  });
});

describe("watch tickets", () => {
  it("round-trips and rejects a wrong secret or expiry", async () => {
    const t = await signWatchTicket(SECRET, claims);
    expect(await verifyWatchTicket(SECRET, t)).toEqual(claims);
    expect(await verifyWatchTicket("other", t)).toBeNull();
    expect(await verifyWatchTicket(SECRET, await signWatchTicket(SECRET, claims, -10))).toBeNull();
    expect(await verifyWatchTicket(SECRET, "garbage")).toBeNull();
  });
});

describe("WatchSession", () => {
  it("starts, relays state, transcript and audio both ways, mutes and stops", async () => {
    const { s, sent, audio, link, closed, handlers, connect } = session();
    await s.onText(await start());
    expect(connect).toHaveBeenCalledWith(claims, expect.anything());
    expect(sent[0]).toEqual({ type: "started", roomId: "rm_1", agentName: "Blah" });
    handlers().onAgentState("speaking");
    handlers().onTranscript("Blah", "Hello", true);
    handlers().onAudio(new Uint8Array([1, 2]));
    expect(sent.slice(1)).toEqual([
      { type: "agent_state", state: "speaking" },
      { type: "transcript", speaker: "Blah", text: "Hello", final: true },
    ]);
    expect(audio).toHaveLength(1);
    s.onAudio(new Uint8Array([3]));
    expect(link.publishAudio).toHaveBeenCalledOnce();
    await s.onText('{"type":"mute","muted":true}');
    expect(link.setMuted).toHaveBeenCalledWith(true);
    expect(sent.at(-1)).toEqual({ type: "muted", muted: true });
    await s.onText('{"type":"stop"}');
    expect(sent.at(-1)).toEqual({ type: "stopped", reason: "client" });
    expect(link.close).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalled();
  });

  it("rejects a bad ticket and a wrong protocol version without joining", async () => {
    const a = session();
    await a.s.onText(await start("junk"));
    expect(a.sent[0]).toMatchObject({ type: "error", code: "unauthorized" });
    expect(a.connect).not.toHaveBeenCalled();
    const b = session();
    await b.s.onText(await start(undefined, 99));
    expect(b.sent[0]).toMatchObject({ type: "error", code: "unsupported" });
  });

  it("needs start first and does not start twice", async () => {
    const { s, sent } = session();
    await s.onText('{"type":"stop"}');
    expect(sent[0]).toMatchObject({ type: "error", code: "bad_message" });
    await s.onText(await start());
    await s.onText(await start());
    expect(sent.at(-1)).toMatchObject({ type: "error", code: "bad_message" });
  });

  it("leaves the room when the socket drops or the room ends", async () => {
    const a = session();
    await a.s.onText(await start());
    await a.s.onClose();
    expect(a.link.close).toHaveBeenCalledOnce();
    const b = session();
    await b.s.onText(await start());
    b.handlers().onRoomEnded();
    await vi.waitFor(() =>
      expect(b.sent.at(-1)).toEqual({ type: "stopped", reason: "room-ended" }),
    );
  });

  it("reports an error when joining the room fails", async () => {
    const sent: WatchServerMessage[] = [];
    const s = new WatchSession(
      { sendText: (m) => sent.push(m), sendAudio: () => {}, close: () => {} },
      SECRET,
      async () => {
        throw new Error("boom");
      },
      async () => "Blah",
    );
    await s.onText(await start());
    expect(sent.at(-1)).toEqual({ type: "stopped", reason: "error" });
  });
});

describe("POST /v1/me/watch/ticket", () => {
  function setup(watchSecret?: string) {
    const storage = new MemoryStorage();
    const livekit = {
      createRoom: async () => {},
      createToken: async () => "tok",
    } as unknown as LiveKitGateway;
    const app = createApp({
      storage,
      livekit,
      apiKeys: ["k"],
      verifier: { verify: async (t) => (t.startsWith("fb:") ? { uid: t.slice(3) } : null) },
      watchSecret,
      watchSocketUrl: "wss://watch.test/v1/watch",
    });
    const post = (token: string, body: unknown) =>
      app.request("/v1/me/watch/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    const call = async (token: string) => {
      const r = await app.request("/v1/me/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ displayName: "Ana" }),
      });
      return ((await r.json()) as { roomId: string }).roomId;
    };
    return { post, call };
  }

  it("is off (404) without the flag", async () => {
    const { post, call } = setup();
    expect((await post("fb:u1", { roomId: await call("fb:u1") })).status).toBe(404);
  });

  it("gives a ticket to a participant only", async () => {
    const { post, call } = setup(SECRET);
    const roomId = await call("fb:u1");
    const ok = await post("fb:u1", { roomId });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { ticket: string; socketUrl: string };
    expect(body.socketUrl).toBe("wss://watch.test/v1/watch");
    expect(await verifyWatchTicket(SECRET, body.ticket)).toMatchObject({ uid: "u1", roomId });
    expect((await post("fb:u2", { roomId })).status).toBe(403);
    expect((await post("bad", { roomId })).status).toBe(401);
    expect((await post("fb:u1", {})).status).toBe(400);
  });
});
