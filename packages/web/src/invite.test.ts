import { describe, expect, it, vi } from "vitest";
import { copyInviteLink } from "./invite.js";

const invite = { id: "inv_1", url: "https://openblah.web.app/j/abc" } as never;

describe("copyInviteLink", () => {
  it("creates an invite and copies its link", async () => {
    const client = { createInvite: vi.fn(async () => invite) };
    const clipboard = { writeText: vi.fn(async () => {}) };
    const result = await copyInviteLink(client, { clipboard, maxUses: 1 });
    expect(client.createInvite).toHaveBeenCalledWith({ maxUses: 1 });
    expect(clipboard.writeText).toHaveBeenCalledWith("https://openblah.web.app/j/abc");
    expect(result).toBe(invite);
  });

  it("hands back the invite when copying fails, so the UI can show the link", async () => {
    const client = { createInvite: vi.fn(async () => invite) };
    const clipboard = {
      writeText: vi.fn(async () => {
        throw new Error("denied");
      }),
    };
    const err = await copyInviteLink(client, { clipboard }).catch((e: unknown) => e);
    expect((err as { invite: unknown }).invite).toBe(invite);
  });
});
