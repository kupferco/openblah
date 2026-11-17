import type { ConsentRecord, Invite, Participant, Room, Storage } from "./types.js";

export class MemoryStorage implements Storage {
  private readonly rooms = new Map<string, Room>();
  private readonly invites = new Map<string, Invite>();
  private readonly participants = new Map<string, Participant>();
  private readonly consents = new Map<string, ConsentRecord>();

  async createRoom(room: Room): Promise<void> {
    if (this.rooms.has(room.id)) throw new Error("room already exists");
    this.rooms.set(room.id, structuredClone(room));
  }

  async getRoom(id: string): Promise<Room | null> {
    const room = this.rooms.get(id);
    return room ? structuredClone(room) : null;
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
