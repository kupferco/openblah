import { vi } from "vitest";
import { act } from "react-test-renderer";
import { OpenBlahApi, OpenBlahClient, type RoomLike } from "@openblah/core";
import type { AuthService, AuthUser } from "../auth/types.js";
import type { PrefsStore } from "../prefs.js";

/** A fake auth service: tests call `emit` to sign in and out. */
export function fakeAuth() {
  let user: AuthUser | null = null;
  const subs = new Set<(u: AuthUser | null) => void>();
  const emit = (u: AuthUser | null) => {
    user = u;
    act(() => subs.forEach((s) => s(u)));
  };
  const auth: AuthService = {
    subscribe: (cb) => {
      subs.add(cb);
      cb(user);
      return () => subs.delete(cb);
    },
    sendEmailLink: vi.fn(async () => {}),
    completeEmailLink: vi.fn(async () => true),
    signInWithGoogle: vi.fn(async () => {
      emit({ uid: "u1", email: "ana@example.com", displayName: "Ana" });
    }),
    signInWithApple: vi.fn(async () => {
      emit({ uid: "u2", email: "ana@privaterelay.appleid.com", displayName: "Ana" });
    }),
    appleAvailable: vi.fn(async () => true),
    signOut: vi.fn(async () => emit(null)),
    getIdToken: async () => "id-token",
  };
  return { auth, emit };
}

export function fakePrefs(): PrefsStore & { saved: unknown[] } {
  let p = { agentName: "Blah" };
  const saved: unknown[] = [];
  return {
    saved,
    load: async () => p,
    save: async (n) => {
      p = n;
      saved.push(n);
    },
  };
}

function fakeRoom() {
  const handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  const room = {
    name: "rm_1",
    state: "disconnected",
    metadata: "{}",
    localParticipant: {
      identity: "u1",
      name: "Ana",
      metadata: JSON.stringify({ role: "host" }),
      isLocal: true,
      isAgent: false,
      isSpeaking: false,
      isMicrophoneEnabled: true,
      attributes: {},
      setMicrophoneEnabled: vi.fn(async () => {}),
      publishData: vi.fn(async () => {}),
    },
    remoteParticipants: new Map<string, unknown>(),
    connect: vi.fn(async () => {
      room.state = "connected";
    }),
    disconnect: vi.fn(async () => {
      room.state = "disconnected";
    }),
    on: vi.fn((e: string, h: (...a: unknown[]) => void) => {
      (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(h);
      return room;
    }),
    off: vi.fn(),
  };
  return room;
}

/** Server state the fake `fetch` reads and changes, so tests can see what the app did. */
export interface ServerState {
  usable: boolean;
  keys: string[];
  trialStarted: boolean;
  llm: string;
  language: string;
  calls: string[];
  bodies: Record<string, unknown>;
  agentPresent: boolean;
}

export function fakeServer() {
  const state: ServerState = {
    usable: false,
    keys: [],
    trialStarted: false,
    llm: "gemini",
    language: "auto",
    calls: [],
    bodies: {},
    agentPresent: false,
  };
  const provider = (id: string, label: string) => {
    const missing = ["gemini", "deepgram", "cartesia"].filter((k) => !state.keys.includes(k));
    const usable = id === "gemini" && (state.trialStarted || missing.length === 0);
    return {
      id,
      label,
      recommended: id === "gemini",
      hasKey: false,
      usable,
      missingKeys: id === "gemini" ? missing : ["openai"],
      copy: `copy ${id}`,
      ...(id === "gemini" ? { keyUrl: "https://aistudio.google.com/apikey" } : {}),
    };
  };
  const current = () => ({
    llm: { provider: state.llm },
    source: "default",
    usable: state.usable,
    language: state.language,
  });
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.replace(/^\/v1/, "");
    const method = init.method ?? "GET";
    state.calls.push(`${method} ${path}`);
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    state.bodies[`${method} ${path}`] = body;
    const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (path === "/me/settings" && method === "GET") return ok(current());
    if (path === "/me/settings") {
      const s = body.settings as { llm?: string; language?: string };
      if (s.llm) state.llm = s.llm;
      if (s.language) state.language = s.language;
      state.usable = provider("gemini", "").usable;
      return ok(current());
    }
    if (path === "/me/onboarding") {
      return ok({
        intro: "Gemini is the quickest way to start: a free key.",
        providers: [provider("gemini", "Gemini"), provider("openai", "OpenAI")],
        trial: null,
        trialAvailable: !state.trialStarted,
        dataTerms: "Your audio goes to Google Gemini.",
        current: current(),
      });
    }
    if (path.endsWith("/check")) return ok({ provider: "x", status: "valid" });
    if (path.startsWith("/me/keys/")) {
      state.keys.push(path.split("/").pop()!);
      return ok({ provider: path.split("/").pop(), tier: "free" });
    }
    if (path === "/me/trial/start") {
      state.trialStarted = true;
      return ok({ started: true, status: {} });
    }
    if (path === "/me/warmup") return ok({ status: "warming" });
    if (path === "/me/calls") {
      return ok(
        { roomId: "rm_1", token: "room-token", expiresIn: 600, livekitUrl: "wss://lk.test" },
        201,
      );
    }
    return ok({ error: "not found" }, 404);
  }) as unknown as typeof fetch;

  const room = fakeRoom();
  const client = new OpenBlahClient({
    createRoom: () => room as unknown as RoomLike,
    api: { baseUrl: "https://api.test/v1", fetch: fetchImpl },
  });
  const api = new OpenBlahApi({
    baseUrl: "https://api.test/v1",
    fetch: fetchImpl,
    headers: async () => ({ authorization: "Bearer id-token" }),
  });
  return { state, room, client, api };
}
