import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectMcp } from "../../packages/agent/src/mcp/client.js";
import {
  createApp,
  KeyCipher,
  McpOAuthService,
  MemoryStorage,
  type LiveKitGateway,
} from "../../packages/server/src/index.js";
import { startTestMcpOAuth, type TestMcpOAuth } from "./server.js";

const API = "api-key-1";
const AGENT = "agent-secret";
const CALLBACK = "http://openblah.test/v1/mcp/callback";

let mcp: TestMcpOAuth;
beforeAll(async () => {
  mcp = await startTestMcpOAuth();
});
afterAll(() => mcp.close());

function setup() {
  const storage = new MemoryStorage();
  const dispatched: string[] = [];
  const livekit: LiveKitGateway = {
    createRoom: vi.fn(async () => {}),
    createToken: vi.fn(async () => "tok"),
    dispatchAgent: vi.fn(async (_id, metadata) => {
      dispatched.push(metadata);
      return { dispatchId: "AD_1", created: true };
    }),
    updateRoomMetadata: vi.fn(async () => {}),
    deleteRoom: vi.fn(async () => {}),
    removeParticipant: vi.fn(async () => {}),
  };
  const service = new McpOAuthService(storage, new KeyCipher("secret-one"), {
    callbackUrl: CALLBACK,
    returnUrlPrefixes: ["openblah-app://mcp"],
    allowLocal: true,
  });
  const app = createApp({
    storage,
    livekit,
    apiKeys: [API],
    mcpOAuth: service,
    agentSecret: AGENT,
  });
  const call = (method: string, path: string, body?: unknown, token = API) =>
    app.request(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  /** What the user's browser does: open the consent URL, follow the redirect to the callback. */
  const consent = async (authorizationUrl: string) => {
    const res = await fetch(authorizationUrl, { redirect: "manual" });
    const location = res.headers.get("location") ?? "";
    expect(location.startsWith(CALLBACK)).toBe(true);
    return app.request(location.replace("http://openblah.test", ""));
  };
  const connect = async (user: string, extra = {}) => {
    const started = await call("POST", `/v1/users/${user}/mcp/connections`, {
      url: mcp.mcpUrl,
      ...extra,
    });
    expect(started.status).toBe(201);
    return (await started.json()) as { id: string; authorizationUrl: string };
  };
  const agentToken = (roomId: string, ownerId: string, connectionId: string, refresh = false) =>
    app.request(`/internal/rooms/${roomId}/mcp-token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${AGENT}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId, connectionId, ...(refresh ? { refresh } : {}) }),
    });
  return { app, storage, call, consent, connect, agentToken, dispatched };
}

describe("MCP OAuth connect, end to end", () => {
  it("connects, calls a tool, refreshes an expired token and disconnects", async () => {
    const t = setup();

    // Connect: PKCE + dynamic registration + resource indicator, least scope.
    const { id, authorizationUrl } = await t.connect("u1", { scope: "mcp:read" });
    const au = new URL(authorizationUrl);
    expect(au.searchParams.get("code_challenge_method")).toBe("S256");
    expect(au.searchParams.get("resource")).toBe(mcp.mcpUrl);
    expect(au.searchParams.get("scope")).toBe("mcp:read");
    expect((await (await t.call("GET", `/v1/users/u1/mcp/connections/${id}`)).json()).status).toBe(
      "pending",
    );
    const page = await t.consent(authorizationUrl);
    expect(page.status).toBe(200);
    expect(mcp.stats.registrations).toBeGreaterThan(0);
    expect(mcp.stats.lastScope).toBe("mcp:read");

    const info = await (await t.call("GET", `/v1/users/u1/mcp/connections/${id}`)).json();
    expect(info.status).toBe("connected");
    const list = await (await t.call("GET", "/v1/users/u1/mcp/connections")).json();
    expect(list.connections).toHaveLength(1);
    // Nothing secret in what clients see, nothing readable in what is stored.
    expect(JSON.stringify(list)).not.toMatch(/at_|rt_|verifier/);
    const stored = JSON.stringify(await t.storage.listMcpConnections("u1"));
    expect(stored).not.toMatch(/at_|rt_/);
    expect(
      (await (await t.call("POST", `/v1/users/u1/mcp/connections/${id}/test`)).json()).ok,
    ).toBe(true);

    // The saved server is merged into the room's list; the dispatch carries no token.
    const room = await (
      await t.call("POST", "/v1/rooms", {
        hostUserId: "u1",
        hostDisplayName: "U One",
        mcp: { allowTools: ["whoami"] },
      })
    ).json();
    expect((await t.call("POST", `/v1/rooms/${room.id}/agent`)).status).toBe(201);
    const meta = JSON.parse(t.dispatched[0] as string);
    expect(meta.mcp.allowTools).toEqual(["whoami"]);
    expect(meta.mcp.servers).toEqual([{ id, url: mcp.mcpUrl, ownerId: "u1", connectionId: id }]);
    expect(t.dispatched[0]).not.toMatch(/at_|rt_/);

    // The agent calls a tool with the owner's token, fetched per request from the server.
    const token = async (o?: { refresh?: boolean }) =>
      (
        (await (await t.agentToken(room.id, "u1", id, o?.refresh)).json()) as {
          accessToken: string;
        }
      ).accessToken;
    const conn = await connectMcp(mcp.mcpUrl, token);
    const callOnce = async () => (await conn.callTool("whoami", {})).text;
    expect(await callOnce()).toContain("signed in as test-user");
    expect(mcp.stats.toolCalls).toBe(1);

    // Expire the token: the next call refreshes it (and the refresh token rotates).
    mcp.expireAccessTokens();
    expect(await callOnce()).toContain("signed in as test-user");
    expect(mcp.stats.refreshes).toBe(1);
    await conn.close();

    // Disconnect deletes the tokens, here and at the server.
    const before = mcp.stats.revocations;
    expect((await t.call("DELETE", `/v1/users/u1/mcp/connections/${id}`)).status).toBe(204);
    expect(await t.storage.listMcpConnections("u1")).toEqual([]);
    expect(mcp.stats.revocations).toBe(before + 1);
    expect(mcp.liveRefreshTokens()).toBe(0);
    expect((await t.agentToken(room.id, "u1", id)).status).toBe(404);
  });

  it("keeps connections private to their owner and tokens to room members", async () => {
    const t = setup();
    const { id, authorizationUrl } = await t.connect("u1");
    await t.consent(authorizationUrl);
    expect((await t.call("GET", `/v1/users/u2/mcp/connections/${id}`)).status).toBe(404);
    expect((await t.call("DELETE", `/v1/users/u2/mcp/connections/${id}`)).status).toBe(404);
    expect((await t.call("GET", "/v1/users/u2/mcp/connections")).status).toBe(200);
    expect((await t.call("GET", "/v1/users/u1/mcp/connections", undefined, "bad")).status).toBe(
      401,
    );

    const room = await (
      await t.call("POST", "/v1/rooms", { hostUserId: "u2", hostDisplayName: "Two" })
    ).json();
    // u1 is not in u2's room, so the agent cannot get u1's token there.
    expect((await t.agentToken(room.id, "u1", id)).status).toBe(403);
    // u2 cannot use u1's connection id as their own.
    expect((await t.agentToken(room.id, "u2", id)).status).toBe(404);
    // And the dispatch for u2's room holds none of u1's servers.
    await t.call("POST", `/v1/rooms/${room.id}/agent`);
    expect(t.dispatched[0]).not.toContain(id);
  });

  it("accepts a consent only once and only with its own state", async () => {
    const t = setup();
    const { authorizationUrl } = await t.connect("u1");
    const res = await fetch(authorizationUrl, { redirect: "manual" });
    const callback = (res.headers.get("location") ?? "").replace("http://openblah.test", "");
    expect((await t.app.request(callback)).status).toBe(200);
    expect((await t.app.request(callback)).status).toBe(400); // replay
    expect((await t.app.request("/v1/mcp/callback?state=mc_x.y&code=z")).status).toBe(400);
  });

  it("reports a refused consent, and reconnecting replaces the old connection", async () => {
    const t = setup();
    const a = await t.connect("u1");
    const refused = new URL(a.authorizationUrl).searchParams.get("state");
    const page = await t.app.request(`/v1/mcp/callback?state=${refused}&error=access_denied`);
    expect(page.status).toBe(400);
    const st = await (await t.call("GET", `/v1/users/u1/mcp/connections/${a.id}`)).json();
    expect(st.status).toBe("error");

    const b = await t.connect("u1");
    await t.consent(b.authorizationUrl);
    const c = await t.connect("u1");
    await t.consent(c.authorizationUrl);
    const ids = (
      (await (await t.call("GET", "/v1/users/u1/mcp/connections")).json()) as {
        connections: { id: string; status: string }[];
      }
    ).connections
      .filter((x) => x.status === "connected")
      .map((x) => x.id);
    expect(ids).toEqual([c.id]);
  });

  it("only returns to allow-listed URLs, and refuses servers without a sign-in", async () => {
    const t = setup();
    const bad = await t.call("POST", "/v1/users/u1/mcp/connections", {
      url: mcp.mcpUrl,
      returnUrl: "https://evil.example/x",
    });
    expect(bad.status).toBe(400);
    const ok = await t.connect("u1", { returnUrl: "openblah-app://mcp/done" });
    const res = await fetch(ok.authorizationUrl, { redirect: "manual" });
    const back = await t.app.request(
      (res.headers.get("location") ?? "").replace("http://openblah.test", ""),
    );
    expect(back.status).toBe(302);
    expect(back.headers.get("location")).toBe(
      `openblah-app://mcp/done?status=connected&id=${ok.id}`,
    );

    const open = await t.call("POST", "/v1/users/u1/mcp/connections", { url: `${mcp.url}/nope` });
    expect(open.status).toBe(400);
  });

  it("is off for public hosts that are local or not https unless allowed", async () => {
    const storage = new MemoryStorage();
    const strict = new McpOAuthService(storage, new KeyCipher("s"), { callbackUrl: CALLBACK });
    await expect(strict.start("u1", { url: mcp.mcpUrl })).rejects.toThrow(/https/);
    await expect(strict.start("u1", { url: "https://127.0.0.1/mcp" })).rejects.toThrow(/public/);
  });
});
