import type { UserRecord } from "./accounts.js";
import type { Provider, StoredKey } from "./keys.js";
import type { ConsentRecord, Invite, Participant, Room, Storage } from "./types.js";

export class MemoryStorage implements Storage {
  private readonly rooms = new Map<string, Room>();
  private readonly invites = new Map<string, Invite>();
  private readonly participants = new Map<string, Participant>();
  private readonly consents = new Map<string, ConsentRecord>();
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

  async listUsage(prefix: string): Promise<Record<string, number>> {
    return Object.fromEntries([...this.usage].filter(([id]) => id.startsWith(prefix)));
  }

  async updateRoom(room: Room): Promise<void> {
    if (!this.rooms.has(room.id)) throw new Error("room not found");
    this.rooms.set(room.id, structuredClone(room));
  }

  async createInvite(invite: Invite): Promise<void> {
    this.invites.set(invite.id, structuredClone(invite));
  }

  async getInvite(id: string): Promise<Invite | null> {
    const inv = this.invites.get(id);
    return inv ? structuredClone(inv) : null;
  }

  async getInviteByTokenHash(tokenHash: string): Promise<Invite | null> {
    for (const inv of this.invites.values()) {
      if (inv.tokenHash === tokenHash) return structuredClone(inv);
    }
    return null;
  }

  async consumeInvite(id: string, now: Date): Promise<Invite | null> {
    const inv = this.invites.get(id);
    if (!inv || inv.revoked || inv.uses >= inv.maxUses) return null;
    if (Date.parse(inv.expiresAt) <= now.getTime()) return null;
    inv.uses += 1;
    return structuredClone(inv);
  }

  async revokeInvite(id: string): Promise<void> {
    const inv = this.invites.get(id);
    if (inv) inv.revoked = true;
  }

  async saveParticipant(p: Participant): Promise<void> {
    this.participants.set(`${p.roomId}\n${p.userId}`, structuredClone(p));
  }

  async getParticipant(roomId: string, userId: string): Promise<Participant | null> {
    const p = this.participants.get(`${roomId}\n${userId}`);
    return p ? structuredClone(p) : null;
  }

  async listParticipants(roomId: string): Promise<Participant[]> {
    return [...this.participants.values()]
      .filter((p) => p.roomId === roomId)
      .map((p) => structuredClone(p));
  }

  async saveConsent(c: ConsentRecord): Promise<void> {
    this.consents.set(`${c.roomId}\n${c.userId}`, structuredClone(c));
  }

  async listConsents(roomId: string): Promise<ConsentRecord[]> {
    return [...this.consents.values()]
      .filter((c) => c.roomId === roomId)
      .map((c) => structuredClone(c));
  }
}
