import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Share: { share: vi.fn() } }));

import { shareInvite } from "./invite.js";

const invite = { id: "inv_1", url: "https://openblah.web.app/j/abc" } as never;

describe("shareInvite", () => {
  it("creates an invite and opens the share sheet with the link", async () => {
    const client = { createInvite: vi.fn(async () => invite) };
    const share = { share: vi.fn(async () => ({ action: "sharedAction" })) };
    const r = await shareInvite(client, { share, message: "Come talk", expiresInSeconds: 600 });
    expect(client.createInvite).toHaveBeenCalledWith({ expiresInSeconds: 600 });
    expect(share.share).toHaveBeenCalledWith({
      message: "Come talk https://openblah.web.app/j/abc",
      url: "https://openblah.web.app/j/abc",
    });
    expect(r).toEqual({ invite, shared: true });
  });

  it("reports a dismissed share sheet", async () => {
    const client = { createInvite: vi.fn(async () => invite) };
    const share = { share: vi.fn(async () => ({ action: "dismissedAction" })) };
    expect((await shareInvite(client, { share })).shared).toBe(false);
  });
});
