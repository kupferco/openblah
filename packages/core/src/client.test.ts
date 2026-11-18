import { describe, expect, it, vi } from "vitest";
import { ConnectionState, RoomEvent } from "livekit-client";
import {
  AGENT_STATE_ATTRIBUTE,
  OpenBlahClient,
  deriveAgentState,
  type RoomLike,
} from "./client.js";

type Handler = () => void;

function fakeRoom(opts: { failConnect?: boolean } = {}) {
  const handlers = new Map<string, Set<Handler>>();
  const local = {
    identity: "me",
    name: "Me",
    isLocal: true,
    isAgent: false,
    isSpeaking: false,
    isMicrophoneEnabled: false,
  };
  const remote = new Map<string, Record<string, unknown>>();
  const room = {
    state: ConnectionState.Disconnected,
    localParticipant: {
      ...local,
      publishData: vi.fn(async () => {}),
      setMicrophoneEnabled: vi.fn(async (on: boolean) => {
        room.localParticipant.isMicrophoneEnabled = on;
      }),
    },
    remoteParticipants: remote,
    connect: vi.fn(async () => {
      if (opts.failConnect) throw new Error("bad token");
      room.state = ConnectionState.Connected;
    }),
    disconnect: vi.fn(async () => {
      room.state = ConnectionState.Disconnected;
    }),
    on: vi.fn((e: string, h: Handler) => {
      (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(h);
      return room;
    }),
    off: vi.fn((e: string, h: Handler) => {
      handlers.get(e)?.delete(h);
      return room;
    }),
  };
  const emit = (e: string, ...args: unknown[]) =>
    handlers.get(e)?.forEach((h) => (h as (...a: unknown[]) => void)(...args));
  return { room, emit, remote, handlers };
}

const agent = (state?: string) => ({
  identity: "agent-1",
  name: "Blah",
  isLocal: false,
  isAgent: true,
  isSpeaking: false,
  isMicrophoneEnabled: true,
  attributes: (state ? { [AGENT_STATE_ATTRIBUTE]: state } : {}) as Record<string, string>,
});

describe("deriveAgentState", () => {
  it("is unavailable without an agent, muted wins", () => {
    expect(deriveAgentState(undefined, false)).toBe("unavailable");
    expect(deriveAgentState(agent("speaking"), true)).toBe("muted");
  });
  it("maps attributes", () => {
    expect(deriveAgentState(agent("thinking"), false)).toBe("thinking");
    expect(deriveAgentState(agent("speaking"), false)).toBe("speaking");
    expect(deriveAgentState(agent("listening"), false)).toBe("listening");
    expect(deriveAgentState(agent(), false)).toBe("listening");
  });
});

describe("OpenBlahClient", () => {
  it("connects with url and token and unmutes the mic", async () => {
    const f = fakeRoom();
    const client = new OpenBlahClient({ createRoom: () => f.room as unknown as RoomLike });
    const connected = vi.fn();
    client.on("connected", connected);
    await client.connect("wss://x", "tok");
    expect(f.room.connect).toHaveBeenCalledWith("wss://x", "tok");
    expect(client.getSnapshot()).toMatchObject({ status: "connected", muted: false });
    expect(client.getSnapshot().participants.map((p) => p.identity)).toEqual(["me"]);
    expect(connected).toHaveBeenCalled();
  });

  it("reports connect errors", async () => {
    const f = fakeRoom({ failConnect: true });
    const client = new OpenBlahClient({ createRoom: () => f.room as unknown as RoomLike });
    const onError = vi.fn();
    client.on("error", onError);
    await expect(client.connect("wss://x", "bad")).rejects.toThrow("bad token");
    expect(onError).toHaveBeenCalled();
    expect(client.getSnapshot()).toMatchObject({ status: "disconnected", error: "bad token" });
    expect(f.handlers.get(RoomEvent.ParticipantConnected)?.size).toBe(0);
  });

  it("mutes and unmutes", async () => {
    const f = fakeRoom();
    const client = new OpenBlahClient({ createRoom: () => f.room as unknown as RoomLike });
    await client.connect("wss://x", "tok");
    await client.setMuted(true);
    expect(client.getSnapshot().muted).toBe(true);
    expect(client.getSnapshot().agentState).toBe("muted");
    expect(await client.toggleMute()).toBe(false);
    expect(client.getSnapshot().muted).toBe(false);
  });

  it("tracks participants and agent state from attributes", async () => {
    const f = fakeRoom();
    const client = new OpenBlahClient({ createRoom: () => f.room as unknown as RoomLike });
    await client.connect("wss://x", "tok");
    expect(client.getSnapshot().agentState).toBe("unavailable");
    const a = agent("thinking");
    f.remote.set("agent-1", a);
    f.emit(RoomEvent.ParticipantConnected);
    expect(client.getSnapshot().participants).toHaveLength(2);
    expect(client.getSnapshot().agentState).toBe("thinking");
    a.attributes[AGENT_STATE_ATTRIBUTE] = "speaking";
    f.emit(RoomEvent.ParticipantAttributesChanged);
    expect(client.getSnapshot().agentState).toBe("speaking");
  });

  it("disconnects, stops listening and notifies", async () => {
    const f = fakeRoom();
    const client = new OpenBlahClient({ createRoom: () => f.room as unknown as RoomLike });
    const changes = vi.fn();
    await client.connect("wss://x", "tok");
    client.on("change", changes);
    await client.disconnect();
    expect(f.room.disconnect).toHaveBeenCalled();
    expect(client.getSnapshot()).toMatchObject({ status: "disconnected", participants: [] });
    changes.mockClear();
    f.emit(RoomEvent.ParticipantConnected);
    expect(changes).not.toHaveBeenCalled();
  });
});

describe("tool approvals", () => {
  const request = (ownerId: string) =>
    new TextEncoder().encode(
      JSON.stringify({
        type: "request",
        id: "ap1",
        tool: "book table",
        summary: "book table (party: 4)",
        ownerId,
        expiresAt: "2030-01-01T00:00:00Z",
      }),
    );

  async function connected() {
    const f = fakeRoom();
    f.remote.set("agent-1", agent("listening"));
    const client = new OpenBlahClient({ createRoom: () => f.room as unknown as RoomLike });
    await client.connect("wss://x", "t");
    return { f, client };
  }

  it("shows a request to the owner only, and only when the agent sent it", async () => {
    const { f, client } = await connected();
    f.emit(
      RoomEvent.DataReceived,
      request("someone-else"),
      f.remote.get("agent-1"),
      0,
      "openblah.approval",
    );
    expect(client.getSnapshot().approvals).toEqual([]);
    f.emit(RoomEvent.DataReceived, request("me"), { isAgent: false }, 0, "openblah.approval");
    expect(client.getSnapshot().approvals).toEqual([]);
    f.emit(RoomEvent.DataReceived, request("me"), f.remote.get("agent-1"), 0, "openblah.approval");
    expect(client.getSnapshot().approvals).toMatchObject([
      { id: "ap1", summary: "book table (party: 4)" },
    ]);
  });

  it("answers to the agent and clears the card; resolved messages clear it too", async () => {
    const { f, client } = await connected();
    f.emit(RoomEvent.DataReceived, request("me"), f.remote.get("agent-1"), 0, "openblah.approval");
    await client.respondToApproval("ap1", true);
    expect(f.room.localParticipant.publishData).toHaveBeenCalledWith(expect.anything(), {
      reliable: true,
      topic: "openblah.approval.response",
      destinationIdentities: ["agent-1"],
    });
    expect(client.getSnapshot().approvals).toEqual([]);
    f.emit(RoomEvent.DataReceived, request("me"), f.remote.get("agent-1"), 0, "openblah.approval");
    const done = new TextEncoder().encode(
      JSON.stringify({ type: "resolved", id: "ap1", status: "executed" }),
    );
    f.emit(RoomEvent.DataReceived, done, f.remote.get("agent-1"), 0, "openblah.approval");
    expect(client.getSnapshot().approvals).toEqual([]);
  });
});
