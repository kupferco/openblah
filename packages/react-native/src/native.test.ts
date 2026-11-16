import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  configureAudio: vi.fn(async () => {}),
  startAudioSession: vi.fn(async () => {}),
  stopAudioSession: vi.fn(async () => {}),
  setAppleAudioConfiguration: vi.fn(async () => {}),
}));
const registerGlobals = vi.hoisted(() => vi.fn());

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@livekit/react-native", () => ({ AudioSession: session, registerGlobals }));

import { createOpenBlahClient, registerOpenBlahGlobals } from "./native.js";
import type { RoomLike } from "@openblah/core";

function fakeRoom(): RoomLike {
  return {
    state: "connected",
    localParticipant: { isMicrophoneEnabled: true, setMicrophoneEnabled: vi.fn() },
    remoteParticipants: new Map(),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as RoomLike;
}

describe("native client", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers globals once, without automatic audio session management", () => {
    registerOpenBlahGlobals();
    registerOpenBlahGlobals();
    expect(registerGlobals).toHaveBeenCalledTimes(1);
    expect(registerGlobals).toHaveBeenCalledWith({ autoConfigureAudioSession: false });
  });

  it("starts the audio session before connecting and stops it on disconnect", async () => {
    const room = fakeRoom();
    const client = createOpenBlahClient({ createRoom: () => room });
    await client.connect("wss://x", "tok");
    expect(session.setAppleAudioConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ audioCategory: "playAndRecord" }),
    );
    expect(session.startAudioSession.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(room.connect).mock.invocationCallOrder[0]!,
    );
    await client.disconnect();
    expect(session.stopAudioSession).toHaveBeenCalled();
  });

  it("stops the audio session when connecting fails", async () => {
    const room = fakeRoom();
    vi.mocked(room.connect).mockRejectedValue(new Error("bad token"));
    const client = createOpenBlahClient({ createRoom: () => room });
    await expect(client.connect("wss://x", "tok")).rejects.toThrow("bad token");
    expect(session.stopAudioSession).toHaveBeenCalled();
  });
});
