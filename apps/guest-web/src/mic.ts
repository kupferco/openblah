import { levelFromSamples, micErrorState, type MicState } from "./lib.js";

export interface MicCheck {
  stop(): void;
}

/**
 * Ask for the microphone and report its level (about 15 times a second).
 * The stream is only used for the meter and is stopped by `stop()`; the call opens its own.
 */
export async function startMicCheck(
  onState: (s: MicState) => void,
  onLevel: (level: number) => void,
): Promise<MicCheck> {
  onState("asking");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    onState(micErrorState(e));
    return { stop() {} };
  }
  onState("ok");
  const Ctx = window.AudioContext;
  const ctx = new Ctx();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(data);
    onLevel(levelFromSamples(data));
  }, 66);
  return {
    stop() {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}
