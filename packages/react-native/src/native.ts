import { Platform } from "react-native";
import { AudioSession, registerGlobals } from "@livekit/react-native";
import { OpenBlahClient, type OpenBlahClientOptions } from "@openblah/core";
import { createCallAudio, type AudioSessionLike } from "./audio.js";

let registered = false;

/**
 * Register the WebRTC globals LiveKit needs. Call once, before anything else,
 * in your app's entry file (`index.js`). Safe to call more than once.
 *
 * `autoConfigureAudioSession` is off: the OpenBlah client sets the Apple audio
 * category (`playAndRecord` with Bluetooth) and starts the audio session itself
 * around each call, so the choice is ours and not the library default.
 */
export function registerOpenBlahGlobals(): void {
  if (registered) return;
  registered = true;
  registerGlobals({ autoConfigureAudioSession: false });
}

/**
 * Create an {@link OpenBlahClient} for React Native: same API as in `@openblah/web`,
 * plus the native audio session (play and record, Bluetooth, survives screen lock).
 */
export function createOpenBlahClient(
  options: Omit<OpenBlahClientOptions, "beforeConnect" | "afterDisconnect"> = {},
): OpenBlahClient {
  const audio = createCallAudio(AudioSession as unknown as AudioSessionLike, Platform.OS);
  return new OpenBlahClient({
    ...options,
    beforeConnect: audio.start,
    afterDisconnect: audio.stop,
  });
}
