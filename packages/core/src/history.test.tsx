import { describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import { createElement } from "react";
import { OpenBlahApi } from "./api.js";
import { useCall, useHistory } from "./react.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item = {
  roomId: "rm_1",
  hostDisplayName: "Dani",
  participants: ["Dani"],
  summary: "S",
  savedAt: "2030-01-01T00:00:00Z",
  expiresAt: null,
};
const record = {
  ...item,
  hostUserId: "h",
  transcript: [],
  notes: ["n"],
  actions: [],
  language: "en",
  actionLog: [],
  retention: "30d",
};

function api(calls: string[]) {
  const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
    const u = new URL(url);
    calls.push(`${init.method} ${u.pathname}${u.search}`);
    if (u.pathname === "/v1/history") return new Response(JSON.stringify({ calls: [item] }));
    if (u.pathname === "/v1/history/rm_1" && init.method === "DELETE") {
      return new Response(JSON.stringify({ roomId: "rm_1", deleted: true, existed: true }));
    }
    if (u.pathname === "/v1/history/rm_1" || u.pathname === "/v1/invites/tok/history") {
      return new Response(JSON.stringify(record));
    }
    return new Response(JSON.stringify({ error: "history not found" }), { status: 404 });
  }) as unknown as typeof fetch;
  return new OpenBlahApi({ baseUrl: "https://s/v1", fetch: fetchFn });
}

async function render<T>(hook: () => T) {
  const out: { current: T } = { current: undefined as T };
  function C() {
    out.current = hook();
    return null;
  }
  await act(async () => {
    create(createElement(C));
  });
  return out;
}

describe("history hooks", () => {
  it("useHistory lists calls and removes one", async () => {
    const calls: string[] = [];
    const a = api(calls);
    const h = await render(() => useHistory({ api: a, userId: "h" }));
    expect(h.current.calls).toEqual([item]);
    expect(calls).toContain("GET /v1/history?actorUserId=h");
    await act(async () => h.current.remove("rm_1"));
    expect(h.current.calls).toEqual([]);
    expect(calls).toContain("DELETE /v1/history/rm_1?actorUserId=h");
  });

  it("useCall reads a call as a user and as a guest, and reports errors", async () => {
    const calls: string[] = [];
    const a = api(calls);
    const u = await render(() => useCall({ api: a, roomId: "rm_1", userId: "h" }));
    expect(u.current.call?.notes).toEqual(["n"]);
    const g = await render(() => useCall({ api: a, inviteToken: "tok" }));
    expect(g.current.call?.summary).toBe("S");
    const bad = await render(() => useCall({ api: a, roomId: "rm_2", userId: "h" }));
    expect(bad.current.call).toBeNull();
    expect(bad.current.error).toBe("history not found");
  });
});
