import type { CallSummary, Invite, Participant, Room, Storage } from "./types.js";

/** How long a room's history is kept (Q4). Default 30 days. */
export type Retention = "30d" | "1y" | "forever";
export const RETENTIONS: readonly Retention[] = ["30d", "1y", "forever"];
export const DEFAULT_RETENTION: Retention = "30d";

const DAY_MS = 86_400_000;
const RETENTION_MS: Record<Retention, number | null> = {
  "30d": 30 * DAY_MS,
  "1y": 365 * DAY_MS,
  forever: null,
};

/** Guests may open history through their invite link for this long (Q3). */
export const GUEST_HISTORY_DAYS = 30;

export function isRetention(v: unknown): v is Retention {
  return typeof v === "string" && (RETENTIONS as readonly string[]).includes(v);
}

export interface TranscriptLine {
  /** Display name of the speaker. */
  speaker: string;
  text: string;
  at: string;
}

export interface ActionLogEntry {
  /** What the agent did, e.g. "Created calendar event". */
  text: string;
  at: string;
}

/**
 * Everything kept about one call. Saved only when the host turned "save notes" on;
 * audio is never stored. Never sent to anyone (no email, no push): it is only
 * served to people who were in the call.
 */
export interface CallHistory {
  roomId: string;
  hostUserId: string;
  hostDisplayName: string;
  /** Who was in the call, by display name. Contact details are not kept here. */
  participants: string[];
  transcript: TranscriptLine[];
  notes: string[];
  actions: CallSummary["actions"];
  summary: string;
  language: "en" | "pt";
  actionLog: ActionLogEntry[];
  startedAt?: string;
  savedAt: string;
}

/** The list entry: no transcript. */
export interface HistoryListItem {
  roomId: string;
  hostDisplayName: string;
  participants: string[];
  summary: string;
  savedAt: string;
  /** When it will be deleted, or null when kept until deleted. */
  expiresAt: string | null;
}

export function expiryOf(savedAt: string, retention: Retention): string | null {
  const ms = RETENTION_MS[retention];
  return ms === null ? null : new Date(Date.parse(savedAt) + ms).toISOString();
}

export function isExpired(savedAt: string, retention: Retention, now: Date): boolean {
  const exp = expiryOf(savedAt, retention);
  return exp !== null && Date.parse(exp) <= now.getTime();
}

export function toListItem(h: CallHistory, retention: Retention): HistoryListItem {
  return {
    roomId: h.roomId,
    hostDisplayName: h.hostDisplayName,
    participants: h.participants,
    summary: h.summary,
    savedAt: h.savedAt,
    expiresAt: expiryOf(h.savedAt, retention),
  };
}

/** Who is asking to read a call's history. */
export type HistoryViewer =
  { kind: "user"; userId: string } | { kind: "guest"; invite: Invite | null };

export interface HistoryAccessInput {
  room: Room;
  history: CallHistory;
  /** The viewer's participant record for this room, if any (users only). */
  participant: Participant | null;
  viewer: HistoryViewer;
  now: Date;
}

/**
 * THE policy function for who may read a call's history. Change the rules here only.
 *  - The host, and any app user who was in the call (by user ID), may read it.
 *  - A guest may read it through their invite token (Q3 default) while the invite
 *    is not revoked, was used, belongs to this room, and the history is under
 *    GUEST_HISTORY_DAYS old. Switch to "guests must sign up" by returning false here.
 */
export function canReadHistory(input: HistoryAccessInput): boolean {
  const { room, history, participant, viewer, now } = input;
  if (viewer.kind === "user") {
    if (viewer.userId === room.hostUserId) return true;
    return !!participant && participant.role !== "guest" && participant.userId === viewer.userId;
  }
  const inv = viewer.invite;
  if (!inv || inv.roomId !== room.id || inv.revoked || inv.uses < 1) return false;
  return now.getTime() < Date.parse(history.savedAt) + GUEST_HISTORY_DAYS * DAY_MS;
}

/** Delete everything stored for a call. Returns whether anything was there. */
export async function deleteCallHistory(
  storage: Pick<Storage, "deleteHistory" | "deleteSummary" | "getHistory">,
  roomId: string,
): Promise<boolean> {
  const existed = (await storage.getHistory(roomId)) !== null;
  await storage.deleteHistory(roomId);
  await storage.deleteSummary(roomId);
  return existed;
}

/** The scheduled cleanup: delete every history past its room's retention. Returns the room ids. */
export async function cleanupExpiredHistory(storage: Storage, now: Date): Promise<string[]> {
  const removed: string[] = [];
  for (const h of await storage.listAllHistories()) {
    const room = await storage.getRoom(h.roomId);
    if (isExpired(h.savedAt, room?.retention ?? DEFAULT_RETENTION, now)) {
      await deleteCallHistory(storage, h.roomId);
      removed.push(h.roomId);
    }
  }
  return removed;
}
