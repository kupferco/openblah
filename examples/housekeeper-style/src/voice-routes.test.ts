import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeMcpServer } from "./fake-mcp.js";
import { createVoiceRoutes, type HousekeeperUser } from "./voice-routes.js";

const USERS: Record<string, HousekeeperUser> = {
  "app-session-1": { id: "u1", displayName: "Maria", mcpToken: "mcp-token-u1" },
};

/** Fake OpenBlah server: records what the backend sends and can be told to fail. */
function fakeOpenBlah() {
  const seen: { path: string; auth: string | null; body: Record<string, unknown> }[] = [];
  let failRooms: { status: number; body: unknown } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    seen.push({
      path,
      auth: new Headers(init.headers).get("authorization"),
      body: JSON.parse(String(init.body)),
    });
    if (path === "/v1/rooms" && failRooms)
      return new Response(JSON.stringify(failRooms.body), { status: failRooms.status });
    if (path === "/v1/rooms")
      return new Response(JSON.stringify({ id: "room-1" }), { status: 201 });
    if (path === "/v1/tokens")
      return new Response(
        JSON.stringify({ token: "room-token", roomId: "room-1", expiresIn: 3600 }),
      );
    if (path === "/v1/warmup") return new Response(JSON.stringify({ status: "warming" }));
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return {
    seen,
    fetchImpl,
    failRoomsWith: (status: number, body: unknown) => (failRooms = { status, body }),
  };
}

describe("housekeeper-style voice routes", () => {
  const mcp = createFakeMcpServer({ "mcp-token-u1": "u1" });
  let mcpUrl = "";
  beforeAll(async () => {
    mcpUrl = await mcp.start();
  });
  afterAll(() => mcp.stop());

  const make = () => {
    const ob = fakeOpenBlah();
    const handler = createVoiceRoutes({
      openblahUrl: "https://openblah.test/",
      openblahApiKey: "secret-api-key",
      mcpUrl,
      authenticate: async (req) =>
        USERS[req.headers.get("authorization")?.replace("Bearer ", "") ?? ""] ?? null,
      fetch: ob.fetchImpl,
    });
    const post = (path: string, session?: string) =>
      handler(
        new Request(`http://app.test${path}`, {
          method: "POST",
          headers: session ? { authorization: `Bearer ${session}` } : {},
        }),
      );
    return { ob, post, handler };
  };

  it("refuses callers who are not logged in", async () => {
    const { ob, post } = make();
    expect((await post("/voice/session")).status).toBe(401);
    expect((await post("/voice/warmup")).status).toBe(401);
    expect(ob.seen).toHaveLength(0);
  });

  it("creates a single-user agent-on room with the user's token and an allow-list", async () => {
    const { ob, post } = make();
    const res = await post("/voice/session", "app-session-1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ roomId: "room-1", token: "room-token", expiresIn: 3600 });

    const [room, token] = ob.seen;
    expect(room?.auth).toBe("Bearer secret-api-key");
    expect(room?.body).toMatchObject({
      hostUserId: "u1",
      agent: "on",
      sensitive: true,
      mcp: {
        servers: [{ id: "housekeeper", url: mcpUrl }],
        userToken: "mcp-token-u1",
        allowTools: ["list_tasks", "add_task"],
        toolOverrides: { add_task: "write" },
      },
    });
    expect(token?.body).toEqual({ roomId: "room-1", userId: "u1", displayName: "Maria" });
  });

  it("never sends the API key or the MCP token to the app", async () => {
    const { post } = make();
    const text = await (await post("/voice/session", "app-session-1")).text();
    expect(text).not.toContain("secret-api-key");
    expect(text).not.toContain("mcp-token-u1");
  });

  it("passes a monthly cap through as 429 with its code", async () => {
    const { ob, post } = make();
    ob.failRoomsWith(429, { error: "monthly cap reached", code: "user_cap" });
    const res = await post("/voice/session", "app-session-1");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "monthly cap reached", code: "user_cap" });
  });

  it("warms up the agent for the logged-in user", async () => {
    const { ob, post } = make();
    expect(await (await post("/voice/warmup", "app-session-1")).json()).toEqual({ status: "ok" });
    expect(ob.seen[0]).toMatchObject({ path: "/v1/warmup", body: { userId: "u1" } });
  });

  it("the user token the route forwards is accepted by the fake MCP server, and no other is", async () => {
    const rpc = (token: string, method: string, params?: unknown) =>
      fetch(mcpUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
    expect((await rpc("wrong", "tools/list")).status).toBe(401);
    const list = (await (await rpc("mcp-token-u1", "tools/list")).json()) as {
      result: { tools: { name: string }[] };
    };
    expect(list.result.tools.map((t) => t.name)).toContain("add_task");
    await rpc("mcp-token-u1", "tools/call", { name: "add_task", arguments: { title: "Buy milk" } });
    expect(mcp.calls.at(-1)).toEqual({ user: "u1", tool: "add_task", args: { title: "Buy milk" } });
  });
});
