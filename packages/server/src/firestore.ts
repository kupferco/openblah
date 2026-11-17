import { createHash } from "node:crypto";
import { Firestore } from "@google-cloud/firestore";
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
}

/** Firestore rejects undefined fields. */
function clean<T extends object>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
