import { describe, expect, it, vi } from "vitest";
import { ConnectionState, RoomEvent } from "livekit-client";
import {
  AI_PAUSED_ATTRIBUTE,
  CONTROL_TOPIC,
  OpenBlahApi,
  OpenBlahApiError,
  OpenBlahClient,
  encodeControlMessage,
  parseControlMessage,
  roleFromMetadata,
  type RoomLike,
} from "./index.js";

type Handler = (...args: unknown[]) => void;

function fakeRoom(role: string) {
  const handlers = new Map<string, Set<Handler>>();
  const remote = new Map<string, Record<string, unknown>>();
  const room = {
    name: "rm_1",
    state: ConnectionState.Connected,
    localParticipant: {
      identity: "u1",
      name: "Me",
      metadata: JSON.stringify({ role }),
      isLocal: true,
      isAgent: false,
      isSpeaking: false,
      isMicrophoneEnabled: true,
      setMicrophoneEnabled: vi.fn(async () => {}),
      publishData: vi.fn<(d: Uint8Array, o?: unknown) => Promise<void>>(async () => {}),
    },
    remoteParticipants: remote,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    on: vi.fn((e: string, h: Handler) => {
      (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(h);
      return room;
    }),
    off: vi.fn((e: string, h: Handler) => {
      handlers.get(e)?.delete(h);
      return room;
    }),
  };
  const emit = (e: string, ...a: unknown[]) => handlers.get(e)?.forEach((h) => h(...a));
  return { room, remote, emit };
}

function mockFetch(responses: { status?: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const agentP = (attrs: Record<string, string> = {}) => ({
  identity: "agent",
  name: "Blah",
  isAgent: true,
  isLocal: false,
  isSpeaking: false,
  isMicrophoneEnabled: true,
  metadata: "",
  attributes: attrs,
});

async function connected(role: string, fetchImpl?: typeof fetch) {
  const f = fakeRoom(role);
  const client = new OpenBlahClient({
    createRoom: () => f.room as unknown as RoomLike,
    api: {
      baseUrl: "https://api.test/v1",
      fetch: fetchImpl,
      headers: () => ({ authorization: "Bearer k" }),
    },
    livekitUrl: "wss://lk.test",
  });
  await client.connect("wss://lk.test", "tok");
  return { f, client };
}

describe("protocol", () => {
  it("round-trips control messages and rejects junk", () => {
    const m = { type: "pause_ai", paused: true } as const;
    expect(parseControlMessage(encodeControlMessage(m))).toEqual(m);
    expect(parseControlMessage("nope")).toBeNull();
    expect(parseControlMessage('{"type":"pause_ai","paused":"yes"}')).toBeNull();
    expect(
      parseControlMessage('{"type":"invite_response","requestId":"r","status":"maybe"}'),
    ).toBeNull();
  });
  it("defaults an unknown role to guest", () => {
    expect(roleFromMetadata('{"role":"host"}')).toBe("host");
    expect(roleFromMetadata('{"role":"admin"}')).toBe("guest");
    expect(roleFromMetadata(undefined)).toBe("guest");
  });
});

describe("OpenBlahApi", () => {
  it("sends host calls with credentials and public calls without", async () => {
    const { fn, calls } = mockFetch([
      { status: 201, body: { id: "inv_1", token: "t", url: "https://x/t" } },
      { body: { hostDisplayName: "Dani" } },
    ]);
    const api = new OpenBlahApi({
      baseUrl: "https://api.test/v1/",
      fetch: fn,
      headers: () => ({ authorization: "Bearer k" }),
    });
    await api.createInvite("rm 1", "u1", { maxUses: 2 });
    expect(calls[0]!.url).toBe("https://api.test/v1/rooms/rm%201/invites");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ actorUserId: "u1", maxUses: 2 });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer k");
    await api.getInvite("tok");
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("throws OpenBlahApiError with the server message", async () => {
    const { fn } = mockFetch([{ status: 404, body: { error: "invite is not valid" } }]);
    const api = new OpenBlahApi({ baseUrl: "https://api.test/v1", fetch: fn });
    await expect(api.getInvite("x")).rejects.toMatchObject({
      status: 404,
      message: "invite is not valid",
    });
    const again = mockFetch([{ status: 404, body: {} }]);
    const err = await new OpenBlahApi({ baseUrl: "https://api.test/v1", fetch: again.fn })
      .getInvite("x")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenBlahApiError);
  });
});

describe("client: roles", () => {
  it("exposes the local role and every participant's role", async () => {
    const { f, client } = await connected("host");
    expect(client.getSnapshot()).toMatchObject({ role: "host", roomId: "rm_1", userId: "u1" });
    f.remote.set("g1", {
      ...agentP(),
      identity: "g1",
      isAgent: false,
      metadata: '{"role":"guest"}',
    });
    f.emit(RoomEvent.ParticipantConnected);
    expect(client.getSnapshot().participants.map((p) => p.role)).toEqual(["host", "guest"]);
  });
});

describe("client: invites and host controls", () => {
  it("creates and revokes invites and removes people as the acting user", async () => {
    const { fn, calls } = mockFetch([
      { status: 201, body: { id: "inv_1", url: "https://x/t" } },
      { body: { revoked: true } },
      { body: { removed: true } },
      { body: { ended: true } },
    ]);
    const { client } = await connected("host", fn);
    expect((await client.createInvite()).url).toBe("https://x/t");
    await client.revokeInvite("inv_1");
    await client.removeParticipant("g1");
    await client.endRoom();
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      "POST https://api.test/v1/rooms/rm_1/invites",
      "DELETE https://api.test/v1/rooms/rm_1/invites/inv_1?actorUserId=u1",
      "DELETE https://api.test/v1/rooms/rm_1/participants/g1?actorUserId=u1",
      "POST https://api.test/v1/rooms/rm_1/end",
    ]);
  });

  it("needs a connection and an api", async () => {
    const c = new OpenBlahClient({ api: { baseUrl: "https://api.test/v1" } });
    await expect(c.createInvite()).rejects.toThrow("Not connected");
    await expect(new OpenBlahClient().getInvitePreview("t")).rejects.toThrow("Pass `api`");
  });

  it("joins with an invite: sends consent, then connects with the guest token", async () => {
    const { fn, calls } = mockFetch([
      { body: { token: "guest-jwt", roomId: "rm_1", userId: "guest_1", role: "guest" } },
    ]);
    const f = fakeRoom("guest");
    const client = new OpenBlahClient({
      createRoom: () => f.room as unknown as RoomLike,
      api: { baseUrl: "https://api.test/v1", fetch: fn },
      livekitUrl: "wss://lk.test",
    });
    await client.joinWithInvite("tok", "Mom", { accepted: true, textVersion: "1" });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      displayName: "Mom",
      consent: { accepted: true, textVersion: "1" },
    });
    expect(f.room.connect).toHaveBeenCalledWith("wss://lk.test", "guest-jwt");
    expect(client.getSnapshot().role).toBe("guest");
  });

  it("does not connect when the server refuses the invite", async () => {
    const { fn } = mockFetch([{ status: 404, body: { error: "invite is not valid" } }]);
    const f = fakeRoom("guest");
    const client = new OpenBlahClient({
      createRoom: () => f.room as unknown as RoomLike,
      api: { baseUrl: "https://api.test/v1", fetch: fn },
      livekitUrl: "wss://lk.test",
    });
    await expect(client.joinWithInvite("bad", "Mom", null)).rejects.toThrow("invite is not valid");
    expect(f.room.connect).not.toHaveBeenCalled();
  });
});

describe("client: pause AI", () => {
  it("publishes a pause request on the control topic", async () => {
    const { f, client } = await connected("guest");
    await client.setAiPaused(true);
    const [data, opts] = f.room.localParticipant.publishData.mock.calls[0] as unknown as [
      Uint8Array,
      { topic: string },
    ];
    expect(opts.topic).toBe(CONTROL_TOPIC);
    expect(parseControlMessage(data)).toEqual({ type: "pause_ai", paused: true });
  });

  it("shows paused from the agent's attribute, to everyone", async () => {
    const { f, client } = await connected("member");
    const a = agentP();
    f.remote.set("agent", a);
    f.emit(RoomEvent.ParticipantConnected);
    expect(client.getSnapshot()).toMatchObject({ aiPaused: false, agentState: "listening" });
    a.attributes[AI_PAUSED_ATTRIBUTE] = "true";
    f.emit(RoomEvent.ParticipantAttributesChanged);
    expect(client.getSnapshot()).toMatchObject({ aiPaused: true, agentState: "paused" });
  });
});

describe("client: mode", () => {
  it("sends set_mode and reads the mode from the agent's attribute", async () => {
    const { f, client } = await connected("host");
    expect(client.getSnapshot().mode).toBe("listening");
    await client.setMode("direct");
    const [data, opts] = f.room.localParticipant.publishData.mock.calls[0] as unknown as [
      Uint8Array,
      { topic: string },
    ];
    expect(opts.topic).toBe(CONTROL_TOPIC);
    expect(parseControlMessage(data)).toEqual({ type: "set_mode", mode: "direct" });
    const a = agentP();
    a.attributes["openblah.mode"] = "direct";
    f.remote.set("agent", a);
    f.emit(RoomEvent.ParticipantConnected);
    expect(client.getSnapshot().mode).toBe("direct");
  });
});

describe("client: invite requests from the agent", () => {
  const payload = (requestId = "r1") =>
    encodeControlMessage({ type: "invite_request", requestId, who: "my mother" });

  it("emits to the host when the agent asks", async () => {
    const { f, client } = await connected("host");
    const onReq = vi.fn();
    client.on("inviteRequest", onReq);
    f.emit(RoomEvent.DataReceived, payload(), agentP(), undefined, CONTROL_TOPIC);
    expect(onReq).toHaveBeenCalledWith({
      type: "invite_request",
      requestId: "r1",
      who: "my mother",
    });
  });

  it("ignores requests from non-agents, other topics, and non-hosts", async () => {
    const host = await connected("host");
    const onHost = vi.fn();
    host.client.on("inviteRequest", onHost);
    const human = { ...agentP(), isAgent: false };
    host.f.emit(RoomEvent.DataReceived, payload(), human, undefined, CONTROL_TOPIC);
    host.f.emit(RoomEvent.DataReceived, payload(), agentP(), undefined, "other");
    expect(onHost).not.toHaveBeenCalled();

    const guest = await connected("guest");
    const onGuest = vi.fn();
    guest.client.on("inviteRequest", onGuest);
    guest.f.emit(RoomEvent.DataReceived, payload(), agentP(), undefined, CONTROL_TOPIC);
    expect(onGuest).not.toHaveBeenCalled();
  });

  it("sends the host's answer back", async () => {
    const { f, client } = await connected("host");
    await client.respondToInviteRequest("r1", "sent");
    const data = f.room.localParticipant.publishData.mock.calls[0]![0] as Uint8Array;
    expect(parseControlMessage(data)).toEqual({
      type: "invite_response",
      requestId: "r1",
      status: "sent",
    });
  });
});
