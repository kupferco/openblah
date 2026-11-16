import { describe, expect, it, vi } from "vitest";
import { CALL_APPLE_AUDIO, createCallAudio, type AudioSessionLike } from "./audio.js";

function fakeSession() {
  return {
    configureAudio: vi.fn(async () => {}),
    startAudioSession: vi.fn(async () => {}),
    stopAudioSession: vi.fn(async () => {}),
    setAppleAudioConfiguration: vi.fn(async () => {}),
  } satisfies AudioSessionLike;
}

describe("createCallAudio", () => {
  it("uses playAndRecord with Bluetooth on iOS, then starts the session", async () => {
    const s = fakeSession();
    await createCallAudio(s, "ios").start();
    expect(s.setAppleAudioConfiguration).toHaveBeenCalledWith({
      audioCategory: "playAndRecord",
      audioCategoryOptions: ["allowBluetooth", "allowBluetoothA2DP", "defaultToSpeaker"],
      audioMode: "voiceChat",
    });
    expect(s.setAppleAudioConfiguration.mock.invocationCallOrder[0]).toBeLessThan(
      s.startAudioSession.mock.invocationCallOrder[0]!,
    );
    expect(CALL_APPLE_AUDIO.audioCategory).toBe("playAndRecord");
  });

  it("skips the Apple configuration on Android", async () => {
    const s = fakeSession();
    await createCallAudio(s, "android").start();
    expect(s.setAppleAudioConfiguration).not.toHaveBeenCalled();
    expect(s.startAudioSession).toHaveBeenCalled();
  });

  it("stops the session", async () => {
    const s = fakeSession();
    await createCallAudio(s, "ios").stop();
    expect(s.stopAudioSession).toHaveBeenCalled();
  });
});
