/** Mobile browser helpers (T30). All are best effort: a failure never blocks joining. */

export function isMobileUserAgent(ua: string): boolean {
  return /iPhone|iPad|iPod|Android/i.test(ua);
}

/** In-app browsers (social apps) often block the microphone or WebRTC. */
export function inAppBrowserName(ua: string): string | null {
  const m = /(FBAN|FBAV|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|Twitter)/i.exec(ua);
  return m ? m[1]!.replace("/", "") : null;
}

/**
 * Safari and Chrome only start audio playback after a tap. Call this inside the join
 * click handler: it resumes a short-lived AudioContext so the call audio can play.
 */
export function unlockAudio(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    void ctx.resume().catch(() => {});
    const osc = ctx.createBufferSource();
    osc.buffer = ctx.createBuffer(1, 1, 22050);
    osc.connect(ctx.destination);
    osc.start(0);
    setTimeout(() => void ctx.close().catch(() => {}), 500);
  } catch {
    /* ignore */
  }
}

export interface WakeLockHandle {
  release(): void;
}

interface WakeLockSentinelLike {
  release(): Promise<void>;
}
interface WakeLockNavigator {
  wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> };
}

/**
 * Keep the screen on while in the call. The lock is dropped by the browser when the tab
 * is hidden, so it is asked for again when the tab becomes visible.
 */
export function holdWakeLock(
  nav: WakeLockNavigator = navigator as unknown as WakeLockNavigator,
  doc: Document | undefined = typeof document === "undefined" ? undefined : document,
): WakeLockHandle {
  if (!doc) return { release() {} };
  let sentinel: WakeLockSentinelLike | null = null;
  let stopped = false;
  const acquire = async () => {
    if (stopped || !nav.wakeLock || doc.visibilityState !== "visible") return;
    try {
      sentinel = await nav.wakeLock.request("screen");
      if (stopped) void sentinel.release().catch(() => {});
    } catch {
      sentinel = null; // denied, low battery or unsupported: carry on without it
    }
  };
  const onVisible = () => void acquire();
  doc.addEventListener("visibilitychange", onVisible);
  void acquire();
  return {
    release() {
      stopped = true;
      doc.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    },
  };
}
