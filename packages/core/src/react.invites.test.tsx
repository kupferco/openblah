import { describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import { createElement } from "react";
import { OpenBlahClient, encodeControlMessage, CONTROL_TOPIC, type RoomLike } from "./index.js";
import {
  OpenBlahProvider,
  useAiPause,
  useConsent,
  useHostControls,
  useInviteJoin,
  useInviteRequests,
  useRole,
  useRoom,
} from "./react.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeRoom(role: string) {
  const handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  const remote = new Map<string, unknown>();
  const room = {
    name: "rm_1",
    state: "connected",
    localParticipant: {
      identity: "u1",
      name: "Me",
      metadata: JSON.stringify({ role }),
      isLocal: true,
      isAgent: false,
      isSpeaking: false,
      isMicrophoneEnabled: true,
      setMicrophoneEnabled: vi.fn(async () => {}),
      publishData: vi.fn<(d: Uint8Array, o?: unknown) => Promise<void>>(async () => {}),
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

function jsonFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string, init: RequestInit) => {
    const key = `${init.method} ${new URL(url).pathname}`;
    const body = routes[key];
    if (body === undefined) return new Response(JSON.stringify({ error: "nope" }), { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

type Hooks = {
  room: ReturnType<typeof useRoom>;
  role: ReturnType<typeof useRole>;
  pause: ReturnType<typeof useAiPause>;
  host: ReturnType<typeof useHostControls>;
  consent: ReturnType<typeof useConsent>;
  invite: ReturnType<typeof useInviteJoin>;
};

function setup(role: string, fetchImpl: typeof fetch, token: string | null = null) {
  const f = fakeRoom(role);
  const client = new OpenBlahClient({
    createRoom: () => f.room as unknown as RoomLike,
    api: { baseUrl: "https://api.test/v1", fetch: fetchImpl },
    livekitUrl: "wss://lk.test",
  });
  const hooks = {} as Hooks;
  const requests = vi.fn(async () => "sent" as const);
  function Probe() {
    hooks.room = useRoom();
    hooks.role = useRole();
    hooks.pause = useAiPause();
    hooks.host = useHostControls();
    hooks.consent = useConsent();
    hooks.invite = useInviteJoin(token);
    useInviteRequests(requests);
    return null;
  }
  act(() => {
    create(createElement(OpenBlahProvider, { client }, createElement(Probe)));
  });
  return { f, client, hooks, requests };
}

const flush = () => act(async () => {});

describe("invite and consent hooks", () => {
  it("useRole and useHostControls follow the token's role", async () => {
    const { hooks } = setup("host", jsonFetch({}));
    expect(hooks.role).toBeNull();
    expect(hooks.host.isHost).toBe(false);
    await act(async () => hooks.room.connect("wss://x", "t"));
    expect(hooks.role).toBe("host");
    expect(hooks.host.isHost).toBe(true);
  });

  it("useAiPause sends the request", async () => {
    const { hooks, f } = setup("member", jsonFetch({}));
    await act(async () => hooks.room.connect("wss://x", "t"));
    expect(hooks.pause.paused).toBe(false);
    await act(async () => hooks.pause.toggle());
    expect(f.room.localParticipant.publishData).toHaveBeenCalled();
  });

  it("useConsent flags missing consent and records acceptance", async () => {
    let missing = [{ userId: "u1", displayName: "Me" }];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      if (init.method === "POST") {
        missing = [];
        return new Response(JSON.stringify({}));
      }
      expect(path).toBe("/v1/rooms/rm_1/consent");
      return new Response(
        JSON.stringify({ version: "1", text: "AI listens", agentName: "Blah", missing }),
      );
    }) as unknown as typeof fetch;
    const { hooks } = setup("member", fetchImpl);
    await act(async () => hooks.room.connect("wss://x", "t"));
    await flush();
    expect(hooks.consent).toMatchObject({ needed: true, text: "AI listens", version: "1" });
    await act(async () => hooks.consent.accept());
    expect(hooks.consent.needed).toBe(false);
  });

  it("useInviteJoin loads the consent text, requires agreement, then joins", async () => {
    const fetchImpl = jsonFetch({
      "GET /v1/invites/tok": {
        hostDisplayName: "Dani",
        agent: "ask",
        agentName: "Blah",
        consent: { version: "1", text: "AI listens" },
      },
      "POST /v1/invites/tok/join": {
        token: "jwt",
        roomId: "rm_1",
        userId: "guest_1",
        role: "guest",
      },
    });
    const { hooks, f } = setup("guest", fetchImpl, "tok");
    await flush();
    expect(hooks.invite.preview?.consent.text).toBe("AI listens");
    let refused: unknown;
    await act(async () => {
      await hooks.invite.join("Mom", false).catch((e: unknown) => (refused = e));
    });
    expect(String(refused)).toContain("Consent is required");
    expect(f.room.connect).not.toHaveBeenCalled();
    await act(async () => hooks.invite.join("Mom", true));
    expect(f.room.connect).toHaveBeenCalledWith("wss://lk.test", "jwt");
  });

  it("useInviteRequests answers the agent with the handler's result", async () => {
    const { hooks, f, requests } = setup("host", jsonFetch({}));
    await act(async () => hooks.room.connect("wss://x", "t"));
    const agent = { isAgent: true, identity: "agent" };
    await act(async () =>
      f.emit(
        "dataReceived",
        encodeControlMessage({ type: "invite_request", requestId: "r1", who: "my mother" }),
        agent,
        undefined,
        CONTROL_TOPIC,
      ),
    );
    expect(requests).toHaveBeenCalledWith({
      type: "invite_request",
      requestId: "r1",
      who: "my mother",
    });
    expect(f.room.localParticipant.publishData).toHaveBeenCalled();
  });
});
