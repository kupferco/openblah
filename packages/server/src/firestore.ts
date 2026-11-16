import { FieldValue, Firestore } from "@google-cloud/firestore";
import type { UserRecord } from "./accounts.js";
import type { Provider, StoredKey } from "./keys.js";
import type { Room, Storage } from "./types.js";

export class FirestoreStorage implements Storage {
  private readonly db: Firestore;

  constructor(db: Firestore = new Firestore()) {
    this.db = db;
  }

  async createRoom(room: Room): Promise<void> {
    // create() fails if the document already exists.
    await this.db.collection("rooms").doc(room.id).create(room);
  }

  async getRoom(id: string): Promise<Room | null> {
    const snap = await this.db.collection("rooms").doc(id).get();
    return snap.exists ? (snap.data() as Room) : null;
  }

  private keyDoc(ownerId: string, provider: Provider) {
    return this.db.collection("users").doc(ownerId).collection("keys").doc(provider);
  }

  async putKey(key: StoredKey): Promise<void> {
    await this.keyDoc(key.ownerId, key.provider).set(key);
  }

  async deleteKey(ownerId: string, provider: Provider): Promise<boolean> {
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

  async getUsage(counterId: string): Promise<number> {
    const snap = await this.db.collection("usage").doc(counterId).get();
    return snap.exists ? Number((snap.data() as { seconds?: number }).seconds ?? 0) : 0;
  }

  async addUsage(counterId: string, seconds: number): Promise<number> {
    const ref = this.db.collection("usage").doc(counterId);
    await ref.set({ seconds: FieldValue.increment(seconds) }, { merge: true });
    return this.getUsage(counterId);
  }
}
