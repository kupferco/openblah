import type { UserRecord } from "./accounts.js";
import type { Provider, StoredKey } from "./keys.js";
import type { Room, Storage } from "./types.js";

export class MemoryStorage implements Storage {
  private readonly rooms = new Map<string, Room>();
  private readonly keys = new Map<string, StoredKey>();
  private readonly users = new Map<string, UserRecord>();
  private readonly usage = new Map<string, number>();

  async createRoom(room: Room): Promise<void> {
    if (this.rooms.has(room.id)) throw new Error("room already exists");
    this.rooms.set(room.id, structuredClone(room));
  }

  async getRoom(id: string): Promise<Room | null> {
    const room = this.rooms.get(id);
    return room ? structuredClone(room) : null;
  }

  async putKey(key: StoredKey): Promise<void> {
    this.keys.set(`${key.ownerId}|${key.provider}`, structuredClone(key));
  }

  async deleteKey(ownerId: string, provider: Provider): Promise<boolean> {
    return this.keys.delete(`${ownerId}|${provider}`);
  }

  async listKeys(ownerId: string): Promise<StoredKey[]> {
    return [...this.keys.values()]
      .filter((k) => k.ownerId === ownerId)
      .map((k) => structuredClone(k));
  }

  async upsertUser(user: UserRecord): Promise<UserRecord> {
    const existing = this.users.get(user.id);
    const merged = existing
      ? { ...existing, email: user.email ?? existing.email, isTest: user.isTest }
      : user;
    this.users.set(user.id, structuredClone(merged));
    return structuredClone(merged);
  }

  async getUser(id: string): Promise<UserRecord | null> {
    const u = this.users.get(id);
    return u ? structuredClone(u) : null;
  }

  async getUsage(counterId: string): Promise<number> {
    return this.usage.get(counterId) ?? 0;
  }

  async addUsage(counterId: string, seconds: number): Promise<number> {
    const total = (this.usage.get(counterId) ?? 0) + seconds;
    this.usage.set(counterId, total);
    return total;
  }
}
