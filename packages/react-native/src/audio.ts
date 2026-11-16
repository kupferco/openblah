/**
 * Audio session setup for calls. The session category is `playAndRecord` with
 * Bluetooth, so a call keeps running with the screen locked and routes to AirPods.
 * The native session object is injected so the logic is testable without a device.
 */

/** The part of `AudioSession` from `@livekit/react-native` that is used here. */
export interface AudioSessionLike {
  configureAudio(config: {
    android?: { audioTypeOptions: unknown; preferredOutputList?: string[] };
    ios?: { defaultOutput?: "speaker" | "earpiece" };
  }): Promise<void>;
  startAudioSession(): Promise<void>;
  stopAudioSession(): Promise<void>;
  setAppleAudioConfiguration(config: {
    audioCategory?: string;
    audioCategoryOptions?: string[];
    audioMode?: string;
  }): Promise<void>;
}

/** Apple audio configuration used for a voice call. */
export const CALL_APPLE_AUDIO = {
  audioCategory: "playAndRecord",
  // allowBluetooth: hands-free profile (AirPods mic); allowBluetoothA2DP: high quality output;
  // defaultToSpeaker: loudspeaker unless a headset or Bluetooth device is connected.
  audioCategoryOptions: ["allowBluetooth", "allowBluetoothA2DP", "defaultToSpeaker"],
  audioMode: "voiceChat",
} as const;

/**
 * Build the `beforeConnect` / `afterDisconnect` pair for `OpenBlahClient`.
 * `platform` is `Platform.OS` from React Native.
 */
export function createCallAudio(session: AudioSessionLike, platform: string) {
  return {
    async start(): Promise<void> {
      if (platform === "ios") {
        await session.setAppleAudioConfiguration({
          audioCategory: CALL_APPLE_AUDIO.audioCategory,
          audioCategoryOptions: [...CALL_APPLE_AUDIO.audioCategoryOptions],
          audioMode: CALL_APPLE_AUDIO.audioMode,
        });
      }
      await session.startAudioSession();
    },
    async stop(): Promise<void> {
      await session.stopAudioSession();
    },
  };
}
