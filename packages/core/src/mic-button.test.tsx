import { describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import { createElement } from "react";
import { OpenBlahClient, type RoomLike } from "./client.js";
import { OpenBlahProvider, useMicButton } from "./react.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setup(opts: { agent?: boolean; timeoutMs?: number; onError?: () => void } = {}) {
  const agent = {
    identity: "agent",
    name: "Blah",
    isLocal: false,
    isAgent: true,
    isSpeaking: false,
    isMicrophoneEnabled: true,
    attributes: { "lk.agent.state": "listening" } as Record<string, string>,
  };
  const handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  const room = {
    state: "connected",
    localParticipant: {
      identity: "me",
      name: "Me",
      isLocal: true,
      isAgent: false,
      isSpeaking: false,
      isMicrophoneEnabled: false,
      setMicrophoneEnabled: vi.fn(async () => {}),
    },
    remoteParticipants: new Map<string, unknown>(opts.agent === false ? [] : [["agent", agent]]),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    on: vi.fn((e: string, h: (...a: unknown[]) => void) => {
      (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(h);
      return room;
    }),
    off: vi.fn(),
  };
  const createRoom = vi.fn(() => room as unknown as RoomLike);
  const client = new OpenBlahClient({ createRoom });
  const start = vi.fn(async () => ({ serverUrl: "wss://x", token: "t" }));
  const apis: ReturnType<typeof useMicButton>[] = [];
  const Probe = () => {
    apis.push(useMicButton({ start, agentTimeoutMs: opts.timeoutMs, onError: opts.onError }));
    return null;
  };
  act(() => {
    create(createElement(OpenBlahProvider, { client }, createElement(Probe), createElement(Probe)));
  });
  const emit = (e: string, ...a: unknown[]) => handlers.get(e)?.forEach((h) => h(...a));
  return { apis, start, room, createRoom, agent, emit };
}

describe("useMicButton", () => {
  it("starts once, shares state across instances and ends on a second tap", async () => {
    const s = setup();
    const last = () => s.apis.slice(-2);
    expect(last().map((a) => a.state)).toEqual(["idle", "idle"]);
    // Two taps at once (two buttons) open one session.
    await act(async () => {
      await Promise.all([last()[0]!.toggle(), last()[1]!.toggle()]);
    });
    expect(s.start).toHaveBeenCalledTimes(1);
    expect(s.room.connect).toHaveBeenCalledTimes(1);
    expect(last().map((a) => a.state)).toEqual(["listening", "listening"]);
    await act(async () => {
      await last()[1]!.toggle();
    });
    expect(s.room.disconnect).toHaveBeenCalled();
    expect(last().map((a) => a.state)).toEqual(["idle", "idle"]);
  });

  it("reports a failed start and stays idle", async () => {
    const s = setup();
    s.start.mockRejectedValueOnce(new Error("nope"));
    const onError = vi.fn();
    const err = new OpenBlahClient({ createRoom: () => s.room as unknown as RoomLike });
    let api!: ReturnType<typeof useMicButton>;
    const P = () => ((api = useMicButton({ start: s.start, onError })), null);
    act(() => void create(createElement(OpenBlahProvider, { client: err }, createElement(P))));
    await act(async () => api.toggle());
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "nope" }));
    expect(api.state).toBe("idle");
  });

  it("shows connecting until the agent has joined, then listening", async () => {
    const s = setup({ agent: false });
    const last = () => s.apis[s.apis.length - 1]!;
    await act(async () => last().toggle());
    expect(last().state).toBe("connecting");
    s.room.remoteParticipants.set("agent", {
      ...s.agent,
      attributes: { "lk.agent.state": "initializing" },
    });
    await act(async () => s.emit("participantConnected"));
    expect(last().state).toBe("connecting");
    s.room.remoteParticipants.set("agent", s.agent);
    await act(async () => s.emit("participantAttributesChanged"));
    expect(last().state).toBe("listening");
  });

  it("fails with a retryable state when the agent never joins", async () => {
    vi.useFakeTimers();
    try {
      const onError = vi.fn();
      const s = setup({ agent: false, timeoutMs: 1000, onError });
      const last = () => s.apis[s.apis.length - 1]!;
      await act(async () => last().toggle());
      expect(last().state).toBe("connecting");
      await act(async () => {
        vi.advanceTimersByTime(1100);
      });
      expect(s.room.disconnect).toHaveBeenCalled();
      expect(onError).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
