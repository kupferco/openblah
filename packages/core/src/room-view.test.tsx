import { describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import { createElement } from "react";
import { OpenBlahClient, type RoomLike } from "./client.js";
import { OpenBlahProvider } from "./react.js";
import {
  defaultLabels,
  defaultTheme,
  resolveLabels,
  resolveTheme,
  useRoomView,
} from "./room-view.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("theme and labels", () => {
  it("fill gaps with defaults and ignore undefined", () => {
    expect(resolveTheme()).toEqual(defaultTheme);
    expect(resolveTheme({ accent: "#f00", radius: undefined })).toEqual({
      ...defaultTheme,
      accent: "#f00",
    });
    expect(resolveLabels({ join: "Entrar" }).join).toBe("Entrar");
    expect(resolveLabels({ join: "Entrar" }).leave).toBe(defaultLabels.leave);
  });
});

function fakeRoom() {
  const handlers = new Map<string, Set<() => void>>();
  const room = {
    state: "disconnected",
    localParticipant: {
      identity: "me",
      name: "Me",
      isLocal: true,
      isAgent: false,
      isSpeaking: false,
      isMicrophoneEnabled: true,
      setMicrophoneEnabled: vi.fn(async () => {}),
    },
    remoteParticipants: new Map(),
    connect: vi.fn(async () => {
      room.state = "connected";
    }),
    disconnect: vi.fn(async () => {
      room.state = "disconnected";
      handlers.get("disconnected")?.forEach((h) => h());
    }),
    on: vi.fn((e: string, h: () => void) => {
      (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(h);
      return room;
    }),
    off: vi.fn(),
  };
  return room;
}

function mount(props: Parameters<typeof useRoomView>[0]) {
  const room = fakeRoom();
  const client = new OpenBlahClient({ createRoom: () => room as unknown as RoomLike });
  const view = {} as ReturnType<typeof useRoomView>;
  function Probe() {
    Object.assign(view, useRoomView(props));
    return null;
  }
  act(() => {
    create(createElement(OpenBlahProvider, { client }, createElement(Probe)));
  });
  return { room, view };
}

describe("useRoomView", () => {
  it("joins on mount and calls onLeave after leaving", async () => {
    const onLeave = vi.fn();
    const { room, view } = mount({ serverUrl: "wss://x", token: "t", onLeave });
    await act(async () => {});
    expect(room.connect).toHaveBeenCalledWith("wss://x", "t");
    expect(view.connected).toBe(true);
    await act(async () => {
      await view.leave();
    });
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("does not join when autoJoin is false and reports errors", async () => {
    const onError = vi.fn();
    const { room, view } = mount({ serverUrl: "wss://x", token: "t", autoJoin: false, onError });
    await act(async () => {});
    expect(room.connect).not.toHaveBeenCalled();
    room.connect.mockRejectedValueOnce(new Error("nope"));
    await act(async () => {
      await view.join();
    });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "nope" }));
  });
});
