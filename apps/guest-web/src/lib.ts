import { OpenBlahApiError } from "@openblah/web";

/** The invite token is the last path segment of `/j/<token>`. Null when there is none. */
export function tokenFromPath(pathname: string): string | null {
  const m = /^\/j\/([^/]+)\/?$/.exec(pathname);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/** What the browser needs to join a call. */
export interface BrowserSupport {
  ok: boolean;
  reason?: string;
}

export function checkBrowserSupport(env: {
  RTCPeerConnection?: unknown;
  mediaDevices?: unknown;
  isSecureContext?: boolean;
}): BrowserSupport {
  if (!env.RTCPeerConnection)
    return { ok: false, reason: "This browser cannot make voice calls (no WebRTC)." };
  if (env.isSecureContext === false || !env.mediaDevices)
    return { ok: false, reason: "This browser cannot use the microphone on this page." };
  return { ok: true };
}

export type FailureKind = "invalid" | "network" | "other";

/**
 * The server answers the same 404 for expired, revoked, used-up and ended-room
 * invites on purpose (it must not reveal which), so the page shows one friendly state for all.
 */
export function classifyError(e: unknown): FailureKind {
  if (e instanceof OpenBlahApiError)
    return e.status === 404 || e.status === 410 ? "invalid" : "other";
  if (e instanceof TypeError) return "network";
  // `useInviteJoin` hands back the message only.
  if (typeof e === "string") {
    if (/not valid|expired|revoked|ended/i.test(e)) return "invalid";
    if (/failed to fetch|networkerror|load failed|network request/i.test(e)) return "network";
  }
  return "other";
}

export type MicState = "idle" | "asking" | "ok" | "blocked" | "missing";

export function micErrorState(e: unknown): MicState {
  const name = (e as { name?: string } | null)?.name;
  if (name === "NotFoundError" || name === "OverconstrainedError") return "missing";
  return "blocked";
}

/** Level 0..1 from time-domain bytes (128 is silence). */
export function levelFromSamples(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += ((s - 128) / 128) ** 2;
  return Math.min(1, Math.sqrt(sum / samples.length) * 3);
}

/**
 * Whether the T19 call-history API exists for this invite. Feature check: any
 * non-2xx answer or network error means "not available", and the link is hidden.
 */
export async function historyAvailable(
  apiBase: string,
  token: string,
  doFetch: typeof fetch = (...a) => fetch(...a),
): Promise<boolean> {
  try {
    const res = await doFetch(
      `${apiBase.replace(/\/+$/, "")}/invites/${encodeURIComponent(token)}/history`,
      {
        method: "HEAD",
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
