import { createHash } from "node:crypto";
import { FieldPath, FieldValue, Firestore } from "@google-cloud/firestore";
import type { UserRecord } from "./accounts.js";
import type { KeyProvider, StoredKey } from "./keys.js";
import type { SettingsLevel } from "./settings.js";
import type { McpConnectionRecord } from "./mcp-oauth.js";
import type { CallHistory } from "./history.js";
import type { CallSummary, ConsentRecord, Invite, Participant, Room, Storage } from "./types.js";

/** Firestore ids cannot hold arbitrary user ids, so hash the pair. */
function pairId(roomId: string, userId: string): string {
  return createHash("sha256").update(`${roomId}\n${userId}`).digest("hex");
}

export class FirestoreStorage implements Storage {
  private readonly db: Firestore;

  constructor(db: Firestore = new Firestore()) {
    this.db = db;
  }

  async createRoom(room: Room): Promise<void> {
    // create() fails if the document already exists.
    await this.db.collection("rooms").doc(room.id).create(clean(room));
  }

  async getRoom(id: string): Promise<Room | null> {
    const snap = await this.db.collection("rooms").doc(id).get();
    return snap.exists ? (snap.data() as Room) : null;
  }

  private keyDoc(ownerId: string, provider: KeyProvider) {
    return this.db.collection("users").doc(ownerId).collection("keys").doc(provider);
  }

  async putKey(key: StoredKey): Promise<void> {
    await this.keyDoc(key.ownerId, key.provider).set(key);
  }

  async deleteKey(ownerId: string, provider: KeyProvider): Promise<boolean> {
    const ref = this.keyDoc(ownerId, provider);
    const snap = await ref.get();
    if (!snap.exists) return false;
    await ref.delete();
    return true;
  }

  async listKeys(ownerId: string): Promise<StoredKey[]> {
    const snap = await this.db.collection("users").doc(ownerId).collection("keys").get();
    return snap.docs.map((d) => d.data() as StoredKey);
  }

  async putMcpConnection(rec: McpConnectionRecord): Promise<void> {
    await this.db.collection("mcpConnections").doc(rec.id).set(clean(rec));
  }

  async getMcpConnection(id: string): Promise<McpConnectionRecord | null> {
    const snap = await this.db.collection("mcpConnections").doc(id).get();
    return snap.exists ? (snap.data() as McpConnectionRecord) : null;
  }

  async listMcpConnections(ownerId: string): Promise<McpConnectionRecord[]> {
    const snap = await this.db.collection("mcpConnections").where("ownerId", "==", ownerId).get();
    return snap.docs.map((d) => d.data() as McpConnectionRecord);
  }

  async deleteMcpConnection(id: string): Promise<void> {
    await this.db.collection("mcpConnections").doc(id).delete();
  }

  async upsertUser(user: UserRecord): Promise<UserRecord> {
    const ref = this.db.collection("accounts").doc(user.id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists ? (snap.data() as UserRecord) : null;
      const merged: UserRecord = existing
        ? { ...existing, ...(user.email ? { email: user.email } : {}), isTest: user.isTest }
        : user;
      tx.set(ref, JSON.parse(JSON.stringify(merged)));
      return merged;
    });
  }

  async getUser(id: string): Promise<UserRecord | null> {
    const snap = await this.db.collection("accounts").doc(id).get();
    return snap.exists ? (snap.data() as UserRecord) : null;
  }

  async getSettings(scopeId: string): Promise<SettingsLevel | null> {
    const snap = await this.db.collection("settings").doc(scopeId).get();
    return snap.exists ? (snap.data() as SettingsLevel) : null;
  }

  async putSettings(scopeId: string, settings: SettingsLevel): Promise<void> {
    await this.db.collection("settings").doc(scopeId).set(clean(settings));
  }

  async getUsage(counterId: string): Promise<number> {
    const snap = await this.db.collection("usage").doc(counterId).get();
    return snap.exists ? Number((snap.data() as { seconds?: number }).seconds ?? 0) : 0;
  }

  async addUsage(counterId: string, seconds: number): Promise<number> {
    const ref = this.db.collection("usage").doc(counterId);
    await ref.set({ seconds: FieldValue.increment(seconds) }, { merge: true });
    return this.getUsage(counterId);
  }

  async listUsage(prefix: string): Promise<Record<string, number>> {
    const snap = await this.db
      .collection("usage")
      .where(FieldPath.documentId(), ">=", prefix)
      .where(FieldPath.documentId(), "<", `${prefix}\uffff`)
      .get();
    return Object.fromEntries(
      snap.docs.map((d) => [d.id, Number((d.data() as { seconds?: number }).seconds ?? 0)]),
    );
  }

  async updateRoom(room: Room): Promise<void> {
    await this.db.collection("rooms").doc(room.id).set(clean(room));
  }

  async createInvite(invite: Invite): Promise<void> {
    await this.db.collection("invites").doc(invite.id).create(invite);
  }

  async getInvite(id: string): Promise<Invite | null> {
    const snap = await this.db.collection("invites").doc(id).get();
    return snap.exists ? (snap.data() as Invite) : null;
  }

  async getInviteByTokenHash(tokenHash: string): Promise<Invite | null> {
    const snap = await this.db
      .collection("invites")
      .where("tokenHash", "==", tokenHash)
      .limit(1)
      .get();
    const doc = snap.docs[0];
    return doc ? (doc.data() as Invite) : null;
  }

  async consumeInvite(id: string, now: Date): Promise<Invite | null> {
    const ref = this.db.collection("invites").doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const inv = snap.data() as Invite;
      if (inv.revoked || inv.uses >= inv.maxUses) return null;
      if (Date.parse(inv.expiresAt) <= now.getTime()) return null;
      const next = { ...inv, uses: inv.uses + 1 };
      tx.update(ref, { uses: next.uses });
      return next;
    });
  }

  async revokeInvite(id: string): Promise<void> {
    await this.db.collection("invites").doc(id).update({ revoked: true });
  }

  async saveParticipant(p: Participant): Promise<void> {
    await this.db.collection("participants").doc(pairId(p.roomId, p.userId)).set(clean(p));
  }

  async getParticipant(roomId: string, userId: string): Promise<Participant | null> {
    const snap = await this.db.collection("participants").doc(pairId(roomId, userId)).get();
    return snap.exists ? (snap.data() as Participant) : null;
  }

  async listParticipants(roomId: string): Promise<Participant[]> {
    const snap = await this.db.collection("participants").where("roomId", "==", roomId).get();
    return snap.docs.map((d) => d.data() as Participant);
  }

  async saveConsent(c: ConsentRecord): Promise<void> {
    await this.db.collection("consents").doc(pairId(c.roomId, c.userId)).set(c);
  }

  async listConsents(roomId: string): Promise<ConsentRecord[]> {
    const snap = await this.db.collection("consents").where("roomId", "==", roomId).get();
    return snap.docs.map((d) => d.data() as ConsentRecord);
  }

  async saveSummary(summary: CallSummary): Promise<void> {
    await this.db.collection("summaries").doc(summary.roomId).set(clean(summary));
  }

  async getSummary(roomId: string): Promise<CallSummary | null> {
    const snap = await this.db.collection("summaries").doc(roomId).get();
    return snap.exists ? (snap.data() as CallSummary) : null;
  }

  async deleteSummary(roomId: string): Promise<void> {
    await this.db.collection("summaries").doc(roomId).delete();
  }

  async saveHistory(history: CallHistory): Promise<void> {
    await this.db.collection("histories").doc(history.roomId).set(clean(history));
  }

  async getHistory(roomId: string): Promise<CallHistory | null> {
    const snap = await this.db.collection("histories").doc(roomId).get();
    return snap.exists ? (snap.data() as CallHistory) : null;
  }

  async listHistories(roomIds: string[]): Promise<CallHistory[]> {
    const refs = roomIds.map((id) => this.db.collection("histories").doc(id));
    if (refs.length === 0) return [];
    const snaps = await this.db.getAll(...refs);
    return snaps.filter((s) => s.exists).map((s) => s.data() as CallHistory);
  }

  async listAllHistories(): Promise<CallHistory[]> {
    const snap = await this.db.collection("histories").get();
    return snap.docs.map((d) => d.data() as CallHistory);
  }

  async deleteHistory(roomId: string): Promise<void> {
    await this.db.collection("histories").doc(roomId).delete();
  }

  async listRoomIdsForUser(userId: string): Promise<string[]> {
    const ids = new Set<string>();
    const hosted = await this.db.collection("rooms").where("hostUserId", "==", userId).get();
    for (const d of hosted.docs) ids.add(d.id);
    const parts = await this.db.collection("participants").where("userId", "==", userId).get();
    for (const d of parts.docs) {
      const p = d.data() as Participant;
      if (p.role !== "guest") ids.add(p.roomId);
    }
    return [...ids];
  }
}

/** Firestore rejects undefined fields. */
function clean<T extends object>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
