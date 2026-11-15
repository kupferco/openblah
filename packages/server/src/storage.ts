import type { Room, Storage } from "./types.js";

export class MemoryStorage implements Storage {
  private readonly rooms = new Map<string, Room>();

  async createRoom(room: Room): Promise<void> {
    if (this.rooms.has(room.id)) throw new Error("room already exists");
    this.rooms.set(room.id, structuredClone(room));
  }

  async getRoom(id: string): Promise<Room | null> {
    const room = this.rooms.get(id);
    return room ? structuredClone(room) : null;
  }
}
