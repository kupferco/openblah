import { describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import { createElement } from "react";
import { OpenBlahClient, type RoomLike } from "./index.js";
import { OpenBlahProvider, useAgentControl, useRoom } from "./react.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeRoom(role: string) {
  const handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  const remote = new Map<string, unknown>();
  const room = {
    name: "rm_1",
    state: "connected",
    metadata: "{}",
    localParticipant: {
      identity: "u1",
      name: "Me",
      metadata: JSON.stringify({ role }),
      isLocal: true,
      isAgent: false,
      isSpeaking: false,
      isMicrophoneEnabled: true,
      setMicrophoneEnabled: vi.fn(async () => {}),
      publishData: vi.fn(async () => {}),
    },
    remoteParticipants: remote,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    on: vi.fn((e: string, h: (...a: unknown[]) => void) => {
      (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(h);
      return room;
    }),
    off: vi.fn(),
  };
  return { room, emit: (e: string, ...a: unknown[]) => handlers.get(e)?.forEach((h) => h(...a)) };
}

const base = {
  agent: "ask",
  agentName: "Blah",
  anyoneCanAddAgent: false,
  idleTimeoutSeconds: 300,
  awaitingConsent: false,
  missing: [],
  requests: [],
  canControl: false,
};

function setup(role: string, routes: (method: string, path: string, body: unknown) => unknown) {
  const f = fakeRoom(role);
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const key = `${init.method} ${u.pathname}`;
    calls.push(key);
    const body = routes(
      init.method ?? "GET",
      u.pathname,
      init.body && JSON.parse(String(init.body)),
    );
    return new Response(JSON.stringify(body ?? {}), { status: 200 });
  }) as unknown as typeof fetch;
  const client = new OpenBlahClient({
    createRoom: () => f.room as unknown as RoomLike,
    api: { baseUrl: "https://api.test/v1", fetch: fetchImpl },
    livekitUrl: "wss://lk.test",
  });
  const h = {} as { room: ReturnType<typeof useRoom>; agent: ReturnType<typeof useAgentControl> };
  function Probe() {
    h.room = useRoom();
    h.agent = useAgentControl();
    return null;
  }
  act(() => {
    create(createElement(OpenBlahProvider, { client }, createElement(Probe)));
  });
  return { f, h, calls, fetchImpl };
}
const flush = () => act(async () => {});

describe("useAgentControl", () => {
  it("loads the state once connected and reports no agent present", async () => {
    const s = setup("host", () => ({ ...base, canControl: true }));
    expect(s.h.agent.state).toBeNull();
    await act(async () => s.h.room.connect("wss://x", "t"));
    await flush();
    expect(s.h.agent.state).toMatchObject({ agent: "ask", canControl: true });
    expect(s.h.agent.present).toBe(false);
    expect(s.h.agent.isHost).toBe(true);
  });

  it("the host brings the agent in and sends it out", async () => {
    const s = setup("host", (m, p) =>
      m === "POST" && p.endsWith("/bring-in")
        ? { status: "awaiting_consent", agent: "on", missing: [{ userId: "u2", displayName: "B" }] }
        : base,
    );
    await act(async () => s.h.room.connect("wss://x", "t"));
    await flush();
    let r: unknown;
    await act(async () => {
      r = await s.h.agent.bringIn();
    });
    expect(r).toMatchObject({ status: "awaiting_consent" });
    await act(async () => s.h.agent.sendOut());
    expect(s.calls).toContain("POST /v1/rooms/rm_1/agent/bring-in");
    expect(s.calls).toContain("POST /v1/rooms/rm_1/agent/send-out");
  });

  it("a member's request reaches the host, who approves it", async () => {
    const member = setup("member", (m, p) =>
      m === "POST" && p.endsWith("/bring-in") ? { status: "requested", agent: "ask" } : base,
    );
    await act(async () => member.h.room.connect("wss://x", "t"));
    await flush();
    let r: unknown;
    await act(async () => {
      r = await member.h.agent.request();
    });
    expect(r).toMatchObject({ status: "requested" });
    expect(member.h.agent.requests).toEqual([]);

    const host = setup("host", () => ({
      ...base,
      requests: [{ id: "ar_1", userId: "u9", displayName: "Maria", requestedAt: "t" }],
    }));
    await act(async () => host.h.room.connect("wss://x", "t"));
    await flush();
    expect(host.h.agent.requests).toHaveLength(1);
    await act(async () => host.h.agent.approve("ar_1"));
    await act(async () => host.h.agent.decline("ar_1"));
    expect(host.calls).toContain("POST /v1/rooms/rm_1/agent/requests/ar_1/approve");
    expect(host.calls).toContain("POST /v1/rooms/rm_1/agent/requests/ar_1/decline");
  });

  it("reloads when the room metadata changes and sends the settings", async () => {
    const s = setup("host", () => base);
    await act(async () => s.h.room.connect("wss://x", "t"));
    await flush();
    const before = s.calls.filter((c) => c.startsWith("GET")).length;
    s.f.room.metadata = '{"agent":"on"}';
    await act(async () => s.f.emit("roomMetadataChanged"));
    await flush();
    expect(s.calls.filter((c) => c.startsWith("GET")).length).toBeGreaterThan(before);
    await act(async () => s.h.agent.setAnyoneCanAdd(true));
    await act(async () => s.h.agent.setIdleTimeoutSeconds(120));
    expect(s.calls.filter((c) => c === "PUT /v1/rooms/rm_1/agent")).toHaveLength(2);
    const bodies = vi.mocked(s.fetchImpl).mock.calls.filter(([, i]) => i?.method === "PUT");
    expect(JSON.parse(String(bodies[0]![1]!.body))).toMatchObject({ anyoneCanAddAgent: true });
    expect(JSON.parse(String(bodies[1]![1]!.body))).toMatchObject({ idleTimeoutSeconds: 120 });
  });
});
