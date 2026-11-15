import { Firestore } from "@google-cloud/firestore";
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
}
