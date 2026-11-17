import { describe, expect, it, vi } from "vitest";
import { fetchRoomKeys, reportUsage, UsageMeter } from "./keys.js";

describe("UsageMeter", () => {
  it("counts only listening, thinking and speaking time", () => {
    let t = 0;
    const m = new UsageMeter(() => t);
    m.setState("initializing");
    t = 5000;
    m.setState("listening");
    t = 15000;
    m.setState("speaking");
    t = 20000;
    m.setState("idle");
    t = 60000;
    expect(m.take()).toBe(15);
    expect(m.take()).toBe(0);
  });
});

describe("server calls", () => {
  const env = { OPENBLAH_SERVER_URL: "http://s/", OPENBLAH_AGENT_SECRET: "sec" };
  it("skips when not wired to a server", async () => {
    expect(await fetchRoomKeys("r", {})).toBeNull();
  });
  it("fetches keys with the agent secret", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ mode: "trial", keys: {} })));
    await fetchRoomKeys("r1", env, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledWith(
      "http://s/internal/rooms/r1/provider-keys",
      expect.objectContaining({ headers: { Authorization: "Bearer sec" } }),
    );
  });
  it("reports exhaustion", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ counted: true, available: false })));
    expect(await reportUsage("r", 10, env, f as unknown as typeof fetch)).toBe(false);
  });
});
