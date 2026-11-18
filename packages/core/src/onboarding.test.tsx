import { describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import { createElement } from "react";
import { useOnboarding } from "./react.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const provider = (id: string, over: object = {}) => ({
  id,
  label: id,
  recommended: id === "gemini",
  hasKey: false,
  usable: false,
  missingKeys: ["gemini", "deepgram", "cartesia"],
  copy: `copy ${id}`,
  ...(id === "gemini" ? { keyUrl: "https://aistudio.google.com/apikey" } : {}),
  ...over,
});

function server() {
  const state = { saved: [] as string[], llm: "gemini", check: "valid" };
  const calls: string[] = [];
  const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push(`${init.method} ${path}`);
    const body = init.body ? JSON.parse(init.body as string) : {};
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (path.endsWith("/onboarding")) {
      const missing = ["gemini", "deepgram", "cartesia"].filter((k) => !state.saved.includes(k));
      return ok({
        intro: "Gemini is the quickest way to start: a free key.",
        providers: [
          provider("gemini", { missingKeys: missing, usable: missing.length === 0 }),
          provider("openai"),
          provider("claude"),
        ],
        trial: null,
        trialAvailable: true,
        dataTerms: "terms",
        current: {
          llm: { provider: state.llm },
          source: "default",
          usable: false,
          language: "auto",
        },
      });
    }
    if (path.endsWith("/check")) return ok({ provider: "x", status: state.check });
    if (path.includes("/keys/")) {
      state.saved.push(path.split("/").pop()!);
      return ok({ provider: path.split("/").pop(), tier: body.tier });
    }
    if (path.endsWith("/settings")) {
      state.llm = body.settings.llm;
      return ok({ llm: { provider: state.llm }, source: "user", usable: true, language: "auto" });
    }
    return new Response("{}", { status: 404 });
  });
  return { state, calls, fetchFn };
}

async function mount(s: ReturnType<typeof server>) {
  let value!: ReturnType<typeof useOnboarding>;
  const api = { baseUrl: "https://x.test/v1", fetch: s.fetchFn as unknown as typeof fetch };
  function C() {
    value = useOnboarding({ api, userId: "u1" });
    return null;
  }
  await act(async () => {
    create(createElement(C));
  });
  return () => value;
}

describe("useOnboarding", () => {
  it("loads, suggests the free Gemini key first and selects it by default", async () => {
    const s = server();
    const get = await mount(s);
    expect(get().loading).toBe(false);
    expect(get().intro).toMatch(/Gemini/);
    expect(get().providers[0]?.id).toBe("gemini");
    expect(get().selected?.id).toBe("gemini");
    expect(get().keyUrl).toContain("aistudio.google.com");
    expect(get().missingKeys).toEqual(["gemini", "deepgram", "cartesia"]);
    expect(get().ready).toBe(false);
    expect(s.calls[0]).toBe("GET /v1/users/u1/onboarding");
  });

  it("checks a key, saves it, and becomes ready once every key is in", async () => {
    const s = server();
    const get = await mount(s);
    for (const k of ["gemini", "deepgram", "cartesia"] as const) {
      await act(async () => get().addKey(k, `key-${k}`));
    }
    expect(s.state.saved).toEqual(["gemini", "deepgram", "cartesia"]);
    expect(get().missingKeys).toEqual([]);
    expect(get().ready).toBe(true);
    await act(async () => {
      await get().finish();
    });
    expect(s.state.llm).toBe("gemini");
  });

  it("does not save a key the vendor rejects", async () => {
    const s = server();
    s.state.check = "invalid";
    const get = await mount(s);
    await act(async () => {
      await get()
        .addKey("gemini", "bad")
        .catch(() => undefined);
    });
    expect(s.state.saved).toEqual([]);
    expect(get().error).toMatch(/not accepted/);
  });

  it("can pick another provider", async () => {
    const s = server();
    const get = await mount(s);
    await act(async () => get().select("claude"));
    expect(get().selected?.id).toBe("claude");
  });
});
