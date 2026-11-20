import type { LiveKitGateway } from "./types.js";
import {
  isAgentState,
  WATCH_AUDIO_SAMPLE_RATE,
  type RoomLink,
  type RoomLinkFactory,
} from "./watch.js";

/** Attribute the agent worker sets on its participant (same as the web client reads). */
const AGENT_STATE_ATTRIBUTE = "lk.agent.state";
const TRANSCRIPTION_TOPIC = "lk.transcription";
const TRANSCRIPTION_FINAL = "lk.transcription_final";

/** Little-endian 16-bit PCM bytes to samples (copies, so alignment never matters). */
export function pcmToInt16(pcm: Uint8Array): Int16Array {
  const out = new Int16Array(Math.floor(pcm.byteLength / 2));
  const view = new DataView(pcm.buffer, pcm.byteOffset, out.length * 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

export function int16ToPcm(samples: Int16Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i]!, true);
  return out;
}

/**
 * Real room link: joins the LiveKit room as the watch user with LiveKit's server-side RTC client.
 * The RTC library is loaded on first use (it is a native module), so servers without the watch
 * flag never load it. LiveKit resamples between the watch's 16 kHz and the room's rate.
 */
export function createLiveKitRoomLink(deps: {
  livekit: LiveKitGateway;
  livekitUrl: string;
  /** Role used for the joining token; the user's stored role is read by the caller. */
  roleFor: (roomId: string, uid: string) => Promise<"host" | "member" | "guest">;
}): RoomLinkFactory {
  return async (claims, handlers) => {
    const rtc = await import("@livekit/rtc-node");
    const role = await deps.roleFor(claims.roomId, claims.uid);
    // Distinct identity from the phone, so the watch and the phone can both be in the room.
    const token = await deps.livekit.createToken({
      roomId: claims.roomId,
      userId: `${claims.uid}~watch`,
      displayName: claims.displayName,
      isHost: role === "host",
      role,
      ttlSeconds: 300,
    });
    const room = new rtc.Room();
    const source = new rtc.AudioSource(WATCH_AUDIO_SAMPLE_RATE, 1);
    const track = rtc.LocalAudioTrack.createAudioTrack("watch-mic", source);
    let muted = false;
    let closed = false;
    const streams = new Set<{ cancel(): Promise<void> }>();

    const reportAgent = (p: { kind?: unknown; attributes: Record<string, string> }) => {
      const s = p.attributes[AGENT_STATE_ATTRIBUTE];
      if (isAgentState(s)) handlers.onAgentState(s);
    };
    room.on(rtc.RoomEvent.ParticipantAttributesChanged, (_changed, p) => reportAgent(p));
    room.on(rtc.RoomEvent.TrackSubscribed, (t, _pub, p) => {
      if (t.kind !== rtc.TrackKind.KIND_AUDIO || p.identity === room.localParticipant?.identity)
        return;
      const stream = new rtc.AudioStream(t, {
        sampleRate: WATCH_AUDIO_SAMPLE_RATE,
        numChannels: 1,
      });
      const reader = stream.getReader();
      streams.add({ cancel: () => reader.cancel() });
      void (async () => {
        for (;;) {
          const { value, done } = await reader.read();
          if (done || closed) break;
          handlers.onAudio(int16ToPcm(value.data));
        }
      })().catch(() => undefined);
    });
    room.on(rtc.RoomEvent.Disconnected, () => {
      if (!closed) handlers.onRoomEnded();
    });
    room.registerTextStreamHandler(TRANSCRIPTION_TOPIC, (reader, from) => {
      void (async () => {
        const text = await reader.readAll();
        if (!text.trim()) return;
        const attrs = reader.info.attributes ?? {};
        const speaker =
          from.identity === room.localParticipant?.identity
            ? claims.displayName
            : room.remoteParticipants.get(from.identity)?.name || from.identity;
        handlers.onTranscript(speaker, text, attrs[TRANSCRIPTION_FINAL] !== "false");
      })().catch(() => undefined);
    });

    await room.connect(deps.livekitUrl, token, { autoSubscribe: true, dynacast: false });
    await room.localParticipant!.publishTrack(track, {
      source: rtc.TrackSource.SOURCE_MICROPHONE,
    } as never);
    for (const p of room.remoteParticipants.values()) reportAgent(p);

    const link: RoomLink = {
      publishAudio(pcm) {
        if (muted || closed) return;
        const samples = pcmToInt16(pcm);
        if (samples.length === 0) return;
        void source
          .captureFrame(new rtc.AudioFrame(samples, WATCH_AUDIO_SAMPLE_RATE, 1, samples.length))
          .catch(() => undefined);
      },
      setMuted(m) {
        muted = m;
      },
      async close() {
        closed = true;
        for (const s of streams) await s.cancel().catch(() => undefined);
        await room.disconnect().catch(() => undefined);
        await source.close().catch(() => undefined);
      },
    };
    return link;
  };
}
