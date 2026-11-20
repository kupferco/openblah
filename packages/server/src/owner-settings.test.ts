import { describe, expect, it, vi } from "vitest";
import { createApp, KeyCipher, KeyStore, MemoryStorage, apiKeyId } from "./index.js";
import type { LiveKitGateway, ProviderKeys } from "./index.js";

const API = "api-key-1";
const AGENT = "agent-secret";
const PRODUCT: ProviderKeys = { gemini: "pg", deepgram: "pd", cartesia: "pc" };

function setup() {
  const storage = new MemoryStorage();
  const livekit: LiveKitGateway = {
    createRoom: vi.fn(async () => {}),
    createToken: vi.fn(async () => "tok"),
    dispatchAgent: vi.fn(async () => ({ dispatchId: "AD_1", created: true })),
    updateRoomMetadata: vi.fn(async () => {}),
    deleteRoom: vi.fn(async () => {}),
    removeParticipant: vi.fn(async () => {}),
    stopAgent: vi.fn(async () => {}),
    sendData: vi.fn(async () => {}),
  };
  const keyStore = new KeyStore(storage, new KeyCipher("secret-one"));
  const app = createApp({
    storage,
    livekit,
    apiKeys: [API, "other-key"],
    keyStore,
    productKeys: { [apiKeyId(API)]: { keys: PRODUCT, tier: "paid" } },
    agentSecret: AGENT,
  });
  const call = (method: string, path: string, body?: unknown, token: string | null = API) =>
    app.request(path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const room = async (host: string) =>
    (
      (await (
        await call("POST", "/v1/rooms", { hostUserId: host, hostDisplayName: "H" })
      ).json()) as {
        id: string;
      }
    ).id;
  const own = async (userId: string) => {
    for (const p of ["gemini", "deepgram", "cartesia"] as const) {
      await keyStore.save(userId, p, "AIza-own", "paid", true);
    }
  };
  return { call, room, storage, own };
}

const json = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("owner settings screen", () => {
  it("serves a static page that holds no key and locks down what it can load", async () => {
    const t = setup();
    const r = await t.call("GET", "/owner", undefined, null);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toContain("connect-src 'self'");
    expect(r.headers.get("cache-control")).toBe("no-store");
    const html = await r.text();
    expect(html).toContain("Who pays for voice");
    expect(html).not.toContain(API);
  });

  it("shows the mode, the cap and counts only", async () => {
    const t = setup();
    const s = await json(await t.call("GET", "/v1/product/settings"));
    expect(s.product).toEqual({
      whoPays: null,
      userMonthlyMinutes: null,
      usersWithOwnKey: 0,
      keyRequiredUsers30d: 0,
      productKeyMinutesThisMonth: 0,
    });
  });

  it("counts users with their own key and key_required hits, leaving out test users", async () => {
    const t = setup();
    await t.call("PUT", "/v1/product/settings", { settings: { whoPays: "user_key" } });
    for (const u of ["u1", "u2", "tester"]) await t.room(u);
    await t.storage.upsertUser({ id: "tester", isTest: true, createdAt: "2026-01-01T00:00:00Z" });
    await t.own("u1");
    await t.own("tester");
    // user_key is the default: u2 and tester are asked for a key (u1 has one)
    for (const u of ["u2", "tester", "u1"]) {
      const id = await t.room(u);
      await t.call("GET", `/v1/rooms/${id}/key-mode`);
    }
    const p = (await json(await t.call("GET", "/v1/product/settings"))).product;
    expect(p.usersWithOwnKey).toBe(1);
    expect(p.keyRequiredUsers30d).toBe(1);
    expect(JSON.stringify(p)).not.toMatch(/u1|u2|tester|AIza/);
  });

  it("counts minutes on the product key only when the product pays", async () => {
    const t = setup();
    await t.call("PUT", "/v1/product/settings", { settings: { whoPays: "product" } });
    const id = await t.room("u1");
    const r = await t.call("POST", `/internal/rooms/${id}/usage`, { seconds: 120 }, AGENT);
    expect(r.status).toBe(200);
    const p = (await json(await t.call("GET", "/v1/product/settings"))).product;
    expect(p.productKeyMinutesThisMonth).toBe(2);
  });

  it("sets and clears the per-user cap, with validation", async () => {
    const t = setup();
    const put = (settings: object) => t.call("PUT", "/v1/product/settings", { settings });
    expect((await json(await put({ userMonthlyMinutes: 90 }))).product.userMonthlyMinutes).toBe(90);
    expect((await json(await put({ userMonthlyMinutes: 0 }))).product.userMonthlyMinutes).toBe(
      null,
    );
    expect((await put({ userMonthlyMinutes: -1 })).status).toBe(400);
    expect((await put({ userMonthlyMinutes: "lots" })).status).toBe(400);
    await put({ whoPays: "product" });
    expect(
      (await json(await t.call("GET", "/v1/product/settings"))).product.userMonthlyMinutes,
    ).toBe(null);
    expect((await json(await put({ userMonthlyMinutes: null }))).product.userMonthlyMinutes).toBe(
      60,
    );
    const id = await t.room("u1");
    const bad = await t.call("PUT", `/v1/rooms/${id}/settings`, {
      actorUserId: "u1",
      settings: { userMonthlyMinutes: 5 },
    });
    expect(bad.status).toBe(400);
  });

  it("stops a user at the product's cap when starting the agent", async () => {
    const t = setup();
    await t.call("PUT", "/v1/product/settings", {
      settings: { whoPays: "product", userMonthlyMinutes: 1 },
    });
    const id = await t.room("u1");
    await t.call("POST", `/internal/rooms/${id}/usage`, { participantSeconds: { u1: 120 } }, AGENT);
    const r = await t.call("POST", `/v1/rooms/${id}/agent`, { actorUserId: "u1" });
    expect(r.status).toBe(429);
    expect((await json(r)).code).toBe("user_cap");
  });
});

describe("settings MCP tool: owner part", () => {
  const rpc = async (token: string, name: string, args: object, t: ReturnType<typeof setup>) => {
    const r = await json(
      await t.call(
        "POST",
        "/mcp/settings",
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        },
        token,
      ),
    );
    const text = r.result.content[0].text as string;
    return { isError: !!r.result.isError, text };
  };

  it("get_settings returns the counts to the product key, not to the agent", async () => {
    const t = setup();
    await t.call("PUT", "/v1/product/settings", { settings: { whoPays: "user_key" } });
    const id = await t.room("u1");
    const args = { roomId: id, actorUserId: "u1" };
    const owner = JSON.parse((await rpc(API, "get_settings", args, t)).text);
    expect(owner.product).toMatchObject({ whoPays: "user_key", usersWithOwnKey: 0 });
    const agent = JSON.parse((await rpc(AGENT, "get_settings", args, t)).text);
    expect(agent.product).toBeUndefined();
    const other = JSON.parse((await rpc("other-key", "get_settings", args, t)).text);
    expect(other.product).toBeUndefined();
  });

  it("only the product key can propose and confirm who pays", async () => {
    const t = setup();
    await t.call("PUT", "/v1/product/settings", { settings: { whoPays: "user_key" } });
    const id = await t.room("u1");
    const args = { roomId: id, actorUserId: "u1", whoPays: "product", userMonthlyMinutes: 30 };
    // the agent (an end user speaking) is refused
    const denied = await rpc(AGENT, "propose_settings_change", args, t);
    expect(denied.isError).toBe(true);
    const prop = JSON.parse((await rpc(API, "propose_settings_change", args, t)).text);
    expect(prop.question).toMatch(/set who pays to product and cap each user at 30 minutes/);
    // nothing yet
    expect((await json(await t.call("GET", "/v1/product/settings"))).product.whoPays).toBe(
      "user_key",
    );
    // a token proposed by the owner cannot be confirmed through the agent
    const stolen = await rpc(
      AGENT,
      "confirm_settings_change",
      { roomId: id, actorUserId: "u1", confirmationToken: prop.confirmationToken },
      t,
    );
    expect(stolen.isError).toBe(true);
    const done = await rpc(
      API,
      "confirm_settings_change",
      { roomId: id, actorUserId: "u1", confirmationToken: prop.confirmationToken },
      t,
    );
    expect(done.isError).toBe(false);
    const p = (await json(await t.call("GET", "/v1/product/settings"))).product;
    expect(p).toMatchObject({ whoPays: "product", userMonthlyMinutes: 30 });
    // the room's own settings did not get the product fields
    expect((await storageRoom(t, id)).settings?.whoPays).toBeUndefined();
  });
});

async function storageRoom(t: ReturnType<typeof setup>, id: string) {
  return (await t.storage.getRoom(id))!;
}
