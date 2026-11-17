/**
 * Wire format between clients and the agent for the T11 controls. Sent as
 * LiveKit data messages on {@link CONTROL_TOPIC}. The agent package keeps a
 * copy of these constants (it does not depend on the browser client).
 */

/** Who someone is in a room. `host` and `member` are app users, `guest` joined by invite link. */
export type Role = "host" | "member" | "guest";

export const CONTROL_TOPIC = "openblah.control";

/** Participant attribute the agent sets to `"true"` while listening is paused. */
export const AI_PAUSED_ATTRIBUTE = "openblah.ai_paused";

/** Client to agent: pause or resume all listening for everyone. */
export interface PauseMessage {
  type: "pause_ai";
  paused: boolean;
}

/** Agent to the host's client: the agent was asked to invite someone ("invite my mother"). */
export interface InviteRequestMessage {
  type: "invite_request";
  requestId: string;
  /** How the speaker described the person, e.g. "my mother". */
  who: string;
}

/** Host's client to agent: what happened to an invite request. */
export interface InviteResponseMessage {
  type: "invite_response";
  requestId: string;
  status: "sent" | "declined";
}

export type ControlMessage = PauseMessage | InviteRequestMessage | InviteResponseMessage;

/** Parse a control message; null for anything that is not one. */
export function parseControlMessage(payload: Uint8Array | string): ControlMessage | null {
  let raw: unknown;
  try {
    const text = typeof payload === "string" ? payload : new TextDecoder().decode(payload);
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (m.type === "pause_ai" && typeof m.paused === "boolean") {
    return { type: "pause_ai", paused: m.paused };
  }
  if (m.type === "invite_request" && typeof m.requestId === "string" && typeof m.who === "string") {
    return { type: "invite_request", requestId: m.requestId, who: m.who };
  }
  if (
    m.type === "invite_response" &&
    typeof m.requestId === "string" &&
    (m.status === "sent" || m.status === "declined")
  ) {
    return { type: "invite_response", requestId: m.requestId, status: m.status };
  }
  return null;
}

export function encodeControlMessage(msg: ControlMessage): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(msg));
}

/** Read the role the server put in the participant metadata. Unknown values give `guest` (least rights). */
export function roleFromMetadata(metadata: string | undefined): Role {
  try {
    const role = (JSON.parse(metadata ?? "") as { role?: unknown }).role;
    if (role === "host" || role === "member" || role === "guest") return role;
  } catch {
    // fall through
  }
  return "guest";
}
