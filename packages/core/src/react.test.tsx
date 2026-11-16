import { describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createElement } from "react";
import { OpenBlahClient, type RoomLike } from "./client.js";
import { OpenBlahProvider, useAgentState, useMute, useParticipants, useRoom } from "./react.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeRoom() {
  const handlers = new Map<string, Set<() => void>>();
  const remote = new Map<string, unknown>();
  const room = {
    state: "connected",
    localParticipant: {
      identity: "me",
      name: "Me",
      isLocal: true,
      isAgent: false,
      isSpeaking: false,
      isMicrophoneEnabled: false,
      setMicrophoneEnabled: vi.fn(async (on: boolean) => {
        room.localParticipant.isMicrophoneEnabled = on;
      }),
    },
    remoteParticipants: remote,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    on: vi.fn((e: string, h: () => void) => {
      (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(h);
      return room;
    }),
    off: vi.fn(),
  };
  return {
    room,
    remote,
    emit: (e: string) => handlers.get(e)?.forEach((h) => h()),
  };
}

type Api = {
  room: ReturnType<typeof useRoom>;
  participants: ReturnType<typeof useParticipants>;
  agent: ReturnType<typeof useAgentState>;
  mute: ReturnType<typeof useMute>;
};

function setup() {
  const f = fakeRoom();
  const client = new OpenBlahClient({ createRoom: () => f.room as unknown as RoomLike });
  const api = {} as Api;
  function Probe() {
    api.room = useRoom();
    api.participants = useParticipants();
    api.agent = useAgentState();
    api.mute = useMute();
    return null;
  }
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(createElement(OpenBlahProvider, { client }, createElement(Probe)));
  });
  return { f, api, client, renderer };
}

describe("React hooks", () => {
  it("throws outside a provider", () => {
    function Bad() {
      useRoom();
      return null;
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => act(() => void create(createElement(Bad)))).toThrow(/OpenBlahProvider/);
    spy.mockRestore();
  });

  it("starts disconnected, muted, with no agent", () => {
    const { api } = setup();
    expect(api.room.status).toBe("disconnected");
    expect(api.participants).toEqual([]);
    expect(api.agent).toBe("unavailable");
    expect(api.mute.muted).toBe(true);
  });

  it("connects through useRoom and shows participants and mute state", async () => {
    const { api, f } = setup();
    await act(async () => {
      await api.room.connect("wss://x", "tok");
    });
    expect(f.room.connect).toHaveBeenCalledWith("wss://x", "tok");
    expect(api.room.status).toBe("connected");
    expect(api.participants.map((p) => p.identity)).toEqual(["me"]);
    expect(api.mute.muted).toBe(false);
    expect(api.agent).toBe("unavailable");
  });

  it("toggles mute and reports agent state from attributes", async () => {
    const { api, f } = setup();
    await act(async () => {
      await api.room.connect("wss://x", "tok");
    });
    await act(async () => {
      await api.mute.toggle();
    });
    expect(api.mute.muted).toBe(true);
    expect(api.agent).toBe("muted");
    await act(async () => {
      await api.mute.setMuted(false);
    });
    f.remote.set("a", {
      identity: "agent-1",
      name: "Blah",
      isLocal: false,
      isAgent: true,
      isSpeaking: false,
      isMicrophoneEnabled: true,
      attributes: { "lk.agent.state": "thinking" },
    });
    await act(async () => f.emit("participantConnected"));
    expect(api.agent).toBe("thinking");
    expect(api.participants).toHaveLength(2);
  });

  it("disconnects on unmount", async () => {
    const { api, f, renderer } = setup();
    await act(async () => {
      await api.room.connect("wss://x", "tok");
    });
    await act(async () => renderer.unmount());
    expect(f.room.disconnect).toHaveBeenCalled();
  });
});
