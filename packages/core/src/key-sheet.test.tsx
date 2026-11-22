import { describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import { createElement } from "react";
import { KeyRequiredError, OpenBlahApi } from "./api.js";
import { useAddKeySheet } from "./react.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe("key_required and key-status", () => {
  it("maps 402 key_required to a typed error", async () => {
    const fetchFn = vi.fn(async () =>
      json(
        {
          error: "Add your own key to keep using voice.",
          code: "key_required",
          reason: "trial_used",
        },
        402,
      ),
    );
    const api = new OpenBlahApi({ baseUrl: "https://x/v1", fetch: fetchFn as never });
    const e = await api.startCall({ displayName: "A" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(KeyRequiredError);
    expect((e as KeyRequiredError).reason).toBe("trial_used");
    expect((e as KeyRequiredError).status).toBe(402);
  });

  it("other 402s stay plain API errors", async () => {
    const fetchFn = vi.fn(async () => json({ error: "used up", code: "trial_exhausted" }, 402));
    const api = new OpenBlahApi({ baseUrl: "https://x/v1", fetch: fetchFn as never });
    const e = await api.startCall({ displayName: "A" }).catch((x: unknown) => x);
    expect(e).not.toBeInstanceOf(KeyRequiredError);
  });

  it("getKeyStatus calls the product user's endpoint", async () => {
    const fetchFn = vi.fn(async () => json({ status: "needs_key", reason: "product_not_paying" }));
    const api = new OpenBlahApi({ baseUrl: "https://x/v1", fetch: fetchFn as never });
    expect(await api.getKeyStatus("u 1")).toEqual({
      status: "needs_key",
      reason: "product_not_paying",
    });
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://x/v1/users/u%201/key-status",
    );
  });
});

describe("useAddKeySheet", () => {
  const prov = (id: string, over: object = {}) => ({
    id,
    label: id,
    recommended: id === "gemini",
    hasKey: false,
    usable: false,
    missingKeys: [id === "claude" ? "claude" : id === "openai" ? "openai" : "gemini"],
    copy: "",
    ...over,
  });
  function mount(sensitive: boolean) {
    const saved: { path: string; body: { tier?: string } }[] = [];
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      const body = init.body ? JSON.parse(init.body as string) : {};
      if (path.endsWith("/onboarding"))
        return json({
          intro: "intro",
          providers: [prov("claude"), prov("openai"), prov("gemini")],
          trial: null,
          trialAvailable: false,
          dataTerms: "",
          current: {
            llm: { provider: "gemini" },
            source: "default",
            usable: false,
            language: "auto",
          },
        });
      if (path.endsWith("/check")) return json({ provider: "x", status: "valid" });
      if (path.endsWith("/settings")) return json({ llm: { provider: "gemini" } });
      saved.push({ path, body });
      return json({ provider: "gemini", tier: body.tier });
    });
    const onDone = vi.fn();
    const api = new OpenBlahApi({ baseUrl: "https://x/v1", fetch: fetchFn as never });
    let hook!: ReturnType<typeof useAddKeySheet>;
    const C = () => ((hook = useAddKeySheet({ api, userId: "u1", sensitive, onDone })), null);
    return { saved, onDone, get: () => hook, C };
  }

  it("lists Gemini first, warns about the free tier and saves a free key", async () => {
    const m = mount(false);
    await act(async () => void create(createElement(m.C)));
    await act(async () => {});
    expect(m.get().providers.map((p) => p.id)).toEqual(["gemini", "openai", "claude"]);
    expect(m.get().showFreeTierWarning).toBe(true);
    await act(async () => m.get().setValue("gemini", "g-key"));
    await act(async () => m.get().submit());
    expect(m.saved[0]).toMatchObject({ path: "/v1/users/u1/keys/gemini", body: { tier: "free" } });
    expect(m.onDone).toHaveBeenCalled();
  });

  it("refuses a free Gemini key in a sensitive room, allows a paid one", async () => {
    const m = mount(true);
    await act(async () => void create(createElement(m.C)));
    await act(async () => {});
    expect(m.get().blocked).toBe(true);
    await act(async () => m.get().setValue("gemini", "g-key"));
    await act(async () => m.get().submit());
    expect(m.saved).toHaveLength(0);
    await act(async () => m.get().setPaidGemini(true));
    expect(m.get().blocked).toBe(false);
    await act(async () => m.get().submit());
    expect(m.saved[0]!.body.tier).toBe("paid");
  });
});
