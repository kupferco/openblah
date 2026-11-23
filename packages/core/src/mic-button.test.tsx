import { describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import { createElement } from "react";
import { OpenBlahClient, type RoomLike } from "./client.js";
import { OpenBlahProvider, useMicButton } from "./react.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setup() {
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
    remoteParticipants: new Map(),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    on: vi.fn(() => room),
    off: vi.fn(),
  };
  const createRoom = vi.fn(() => room as unknown as RoomLike);
  const client = new OpenBlahClient({ createRoom });
  const start = vi.fn(async () => ({ serverUrl: "wss://x", token: "t" }));
  const apis: ReturnType<typeof useMicButton>[] = [];
  const Probe = () => {
    apis.push(useMicButton({ start }));
    return null;
  };
  act(() => {
    create(createElement(OpenBlahProvider, { client }, createElement(Probe), createElement(Probe)));
  });
  return { apis, start, room, createRoom };
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
});
