import { describe, expect, it, vi } from "vitest";
import { startWarmup, warmup } from "./warmup.js";

const opts = (f: typeof fetch) => ({ serverUrl: "https://s/", apiKey: "k", userId: "u", fetch: f });
const reply = (status: number, body: unknown = {}) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("warmup", () => {
  it("posts the user id with the key", async () => {
    const f = reply(200, { status: "warming" });
    expect(await warmup(opts(f))).toBe("warming");
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://s/v1/warmup");
    expect(init.headers.Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body)).toEqual({ userId: "u" });
  });

  it("never throws", async () => {
    expect(await warmup(opts(reply(429)))).toBe("limited");
    expect(await warmup(opts(reply(500)))).toBe("unavailable");
    const boom = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await warmup(opts(boom))).toBe("unavailable");
  });

  it("warms on open and when the page becomes visible", () => {
    const f = reply(200, { status: "warm" });
    let handler: () => void = () => undefined;
    const doc = {
      visibilityState: "hidden" as DocumentVisibilityState,
      addEventListener: vi.fn((_: string, h: () => void) => (handler = h)),
      removeEventListener: vi.fn(),
    };
    const stop = startWarmup(opts(f), doc as never);
    expect(f).toHaveBeenCalledTimes(1);
    handler();
    expect(f).toHaveBeenCalledTimes(1);
    doc.visibilityState = "visible";
    handler();
    expect(f).toHaveBeenCalledTimes(2);
    stop();
    expect(doc.removeEventListener).toHaveBeenCalled();
  });
});
