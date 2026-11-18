import { describe, expect, it, vi } from "vitest";
import { lastHumanLeft, reportAgentOff } from "./keys.js";

describe("agent presence", () => {
  it("leaves when no human is left, ignoring other agents", () => {
    expect(lastHumanLeft([])).toBe(true);
    expect(lastHumanLeft([{ isAgent: true }])).toBe(true);
    expect(lastHumanLeft([{ isAgent: true }, { isAgent: false }])).toBe(false);
  });

  it("tells the server the room is off, with the agent secret", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    const ok = await reportAgentOff(
      "rm 1",
      { OPENBLAH_SERVER_URL: "https://s.example/", OPENBLAH_AGENT_SECRET: "sek" },
      fetchFn as unknown as typeof fetch,
    );
    expect(ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://s.example/internal/rooms/rm%201/agent-off",
      expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer sek" } }),
    );
  });

  it("does nothing without a server configured, and never throws", async () => {
    expect(await reportAgentOff("r", {})).toBe(false);
    const boom = vi.fn(async () => {
      throw new Error("down");
    });
    expect(
      await reportAgentOff(
        "r",
        { OPENBLAH_SERVER_URL: "https://s", OPENBLAH_AGENT_SECRET: "x" },
        boom as unknown as typeof fetch,
      ),
    ).toBe(false);
  });
});
