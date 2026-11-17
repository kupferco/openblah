/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";
import {
  apiKeyId,
  createApp,
  KeyCipher,
  KeyStore,
  MemoryStorage,
  resolveModel,
  TrialService,
} from "./index.js";
import type { KeyChecker, LiveKitGateway, ProviderKeys, SettingsLevel } from "./index.js";

const API = "api-key-1";
const AGENT = "agent-secret";
const KEYS: ProviderKeys = { gemini: "pg", deepgram: "pd", cartesia: "pc" };

function setup(
  opts: {
    product?: Partial<ProviderKeys>;
    trial?: boolean;
    server?: SettingsLevel;
    now?: () => Date;
    check?: KeyChecker;
  } = {},
) {
  const storage = new MemoryStorage();
  const livekit: LiveKitGateway = {
    createRoom: vi.fn(async () => {}),
    createToken: vi.fn(async () => "tok"),
    dispatchAgent: vi.fn(async () => ({ dispatchId: "AD_1", created: true })),
    updateRoomMetadata: vi.fn(async () => {}),
    deleteRoom: vi.fn(async () => {}),
    removeParticipant: vi.fn(async () => {}),
  };
  const app = createApp({
    storage,
    livekit,
    apiKeys: [API],
    keyStore: new KeyStore(storage, new KeyCipher("secret-one")),
    productKeys: opts.product
      ? { [apiKeyId(API)]: { keys: { ...KEYS, ...opts.product }, tier: "paid" } }
      : {},
    trial: opts.trial ? { keys: KEYS, service: new TrialService(storage) } : undefined,
    agentSecret: AGENT,
    serverSettings: opts.server,
    keyChecker: opts.check,
    now: opts.now,
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
  const room = async (host = "host-1") => {
    const r = await call("POST", "/v1/rooms", { hostUserId: host, hostDisplayName: "Host" });
    return ((await r.json()) as { id: string }).id;
  };
  return { call, room, storage, livekit };
}

const json = async (r: Response) => (await r.json()) as Record<string, any>;

describe("precedence", () => {
  const claude = { llm: { provider: "claude" as const } };
  const openai = { llm: { provider: "openai" as const } };
  const gemini = { llm: { provider: "gemini" as const } };

  it("room beats user beats product beats server beats default", () => {
    expect(resolveModel({}).source).toBe("default");
    expect(resolveModel({ server: openai })).toEqual({ choice: openai.llm, source: "server" });
    expect(resolveModel({ server: openai, product: gemini }).source).toBe("product");
    expect(resolveModel({ server: openai, product: gemini, user: claude }).choice.provider).toBe(
      "claude",
    );
    expect(
      resolveModel({ server: openai, product: gemini, user: claude, room: openai }).source,
    ).toBe("room");
  });

  it("an empty room level falls through to the level below", () => {
    expect(resolveModel({ room: {}, user: claude }).source).toBe("user");
  });

  it("applies through the API: server default, then user, then room", async () => {
    const t = setup({ product: { claude: "ck", openai: "ok" }, server: openai });
    const id = await t.room();
    const view = async () =>
      json(await t.call("GET", `/v1/rooms/${id}/settings?viewerUserId=host-1`));
    expect((await view()).llm.provider).toBe("openai");
    expect((await view()).source).toBe("server");
    await t.call("PUT", "/v1/users/host-1/settings", { settings: { llm: "gemini" } });
    expect(await view()).toMatchObject({ llm: { provider: "gemini" }, source: "user" });
    await t.call("PUT", `/v1/rooms/${id}/settings`, {
      actorUserId: "host-1",
      settings: { llm: "claude" },
    });
    expect(await view()).toMatchObject({ llm: { provider: "claude" }, source: "room" });
    await t.call("PUT", `/v1/rooms/${id}/settings`, {
      actorUserId: "host-1",
      settings: { llm: null },
    });
    expect((await view()).source).toBe("user");
  });

  it("the product level sits under the user level", async () => {
    const t = setup({ product: { claude: "ck" } });
    expect(
      (await t.call("PUT", "/v1/product/settings", { settings: { llm: "claude" } })).status,
    ).toBe(200);
    const id = await t.room();
    const v = async () => json(await t.call("GET", `/v1/rooms/${id}/settings?viewerUserId=host-1`));
    expect((await v()).source).toBe("product");
    await t.call("PUT", "/v1/users/host-1/settings", { settings: { llm: "gemini" } });
    expect((await v()).source).toBe("user");
  });
});

describe("validation: the chosen provider needs a usable key", () => {
  it("refuses Claude with no key, naming what to do", async () => {
    const t = setup({ product: {} });
    const id = await t.room();
    const r = await t.call("PUT", `/v1/rooms/${id}/settings`, {
      actorUserId: "host-1",
      settings: { llm: "claude" },
    });
    expect(r.status).toBe(409);
    expect(await json(r)).toMatchObject({ code: "no_key" });
    expect(
      (await json(await t.call("GET", `/v1/rooms/${id}/settings?viewerUserId=host-1`))).llm
        .provider,
    ).toBe("gemini");
  });

  it("accepts Claude with a product key or the host's own BYOK keys", async () => {
    const product = setup({ product: { claude: "ck" } });
    const id = await product.room();
    expect(
      (
        await product.call("PUT", `/v1/rooms/${id}/settings`, {
          actorUserId: "host-1",
          settings: { llm: "claude" },
        })
      ).status,
    ).toBe(200);

    const byok = setup({ product: undefined, trial: true });
    const rid = await byok.room("u1");
    const body = { actorUserId: "u1", settings: { llm: "claude" } };
    expect((await byok.call("PUT", `/v1/rooms/${rid}/settings`, body)).status).toBe(409);
    for (const p of ["gemini", "deepgram", "cartesia", "claude"]) {
      await byok.call("PUT", `/v1/users/u1/keys/${p}`, { key: `k-${p}`, tier: "paid" });
    }
    expect((await byok.call("PUT", `/v1/rooms/${rid}/settings`, body)).status).toBe(200);
  });

  it("the trial covers Gemini only", async () => {
    const t = setup({ trial: true });
    const id = await t.room();
    const set = (llm: string) =>
      t.call("PUT", `/v1/rooms/${id}/settings`, { actorUserId: "host-1", settings: { llm } });
    expect((await set("gemini")).status).toBe(200);
    expect((await set("openai")).status).toBe(409);
  });

  it("rejects bad input and non-hosts", async () => {
    const t = setup({ product: { claude: "ck" } });
    const id = await t.room();
    const put = (actor: string, settings: unknown) =>
      t.call("PUT", `/v1/rooms/${id}/settings`, { actorUserId: actor, settings });
    expect((await put("host-1", { llm: "llama" })).status).toBe(400);
    expect((await put("host-1", { language: "fr" })).status).toBe(400);
    expect((await put("host-1", {})).status).toBe(400);
    expect((await put("someone", { llm: "claude" })).status).toBe(403);
  });

  it("changes language and agent name on the room", async () => {
    const t = setup({ product: {} });
    const id = await t.room();
    await t.call("PUT", `/v1/rooms/${id}/settings`, {
      actorUserId: "host-1",
      settings: { language: "pt", agentName: "Ana" },
    });
    const v = await json(await t.call("GET", `/v1/rooms/${id}/settings?viewerUserId=host-1`));
    expect(v).toMatchObject({ language: "pt", agentName: "Ana" });
    expect(t.livekit.updateRoomMetadata).toHaveBeenCalled();
  });

  it("passes the resolved model and language to the agent on dispatch", async () => {
    const t = setup({ product: { claude: "ck" } });
    const id = await t.room();
    await t.call("PUT", `/v1/rooms/${id}/settings`, {
      actorUserId: "host-1",
      settings: { llm: { provider: "claude", model: "claude-sonnet-5-5" }, language: "pt" },
    });
    await t.call("POST", `/v1/rooms/${id}/agent`, {});
    const meta = JSON.parse((t.livekit.dispatchAgent as any).mock.calls[0][1]);
    expect(meta.providers.llm).toEqual({ provider: "claude", model: "claude-sonnet-5-5" });
    expect(meta.language).toBe("pt");
  });
});

describe("onboarding", () => {
  it("suggests the free Gemini key first and never echoes a key", async () => {
    const check = vi.fn<KeyChecker>(async () => ({ status: "valid" }));
    const t = setup({ trial: true, check });
    const o = await json(await t.call("GET", "/v1/users/u1/onboarding"));
    expect(o.providers[0]).toMatchObject({ id: "gemini", recommended: true });
    expect(o.providers[0].keyUrl).toContain("aistudio.google.com");
    expect(o.providers[0].copy).toMatch(/free/i);
    expect(o.intro).toMatch(/Gemini/);
    expect(o.providers[1]).toMatchObject({
      id: "openai",
      missingKeys: ["gemini", "deepgram", "cartesia", "openai"],
    });
    const r = await t.call("POST", "/v1/users/u1/keys/gemini/check", { key: "AIza-secret-value" });
    expect(await json(r)).toEqual({ provider: "gemini", status: "valid" });
    expect(check).toHaveBeenCalledWith("gemini", "AIza-secret-value");
    expect(
      JSON.stringify(await json(await t.call("GET", "/v1/users/u1/onboarding"))),
    ).not.toContain("AIza");
  });

  it("starting the trial needs a signed-in user", async () => {
    const t = setup({ trial: true });
    expect((await t.call("POST", "/v1/users/u1/trial/start", {})).status).toBe(401);
    await t.storage.upsertUser({ id: "u1", isTest: false, createdAt: "2026-01-01T00:00:00Z" });
    expect((await t.call("POST", "/v1/users/u1/trial/start", {})).status).toBe(200);
    expect((await json(await t.call("GET", "/v1/users/u1/settings"))).llm.provider).toBe("gemini");
  });
});

describe("settings MCP tool", () => {
  const rpc = (
    t: ReturnType<typeof setup>,
    method: string,
    params: unknown,
    token: string | null = AGENT,
  ) => t.call("POST", "/mcp/settings", { jsonrpc: "2.0", id: 1, method, params }, token);
  const tool = async (t: ReturnType<typeof setup>, name: string, args: object) => {
    const r = await json(await rpc(t, "tools/call", { name, arguments: args }));
    const text = r.result.content[0].text as string;
    return { isError: !!r.result.isError, text, data: r.result.isError ? null : JSON.parse(text) };
  };

  it("needs credentials", async () => {
    const t = setup();
    expect((await rpc(t, "tools/list", {}, null)).status).toBe(401);
    expect((await rpc(t, "tools/list", {}, "nope")).status).toBe(401);
  });

  it("initializes and lists the three tools", async () => {
    const t = setup();
    expect(
      (await json(await rpc(t, "initialize", { protocolVersion: "2025-03-26" }))).result
        .capabilities,
    ).toEqual({ tools: {} });
    const names = (await json(await rpc(t, "tools/list", {}))).result.tools.map((x: any) => x.name);
    expect(names).toEqual(["get_settings", "propose_settings_change", "confirm_settings_change"]);
  });

  it("a proposal changes nothing; only the confirmation does", async () => {
    const t = setup({ product: { claude: "ck" } });
    const id = await t.room();
    const args = { roomId: id, actorUserId: "host-1" };
    const p = await tool(t, "propose_settings_change", { ...args, llm: "claude" });
    expect(p.data.status).toBe("needs_confirmation");
    expect(p.data.question).toMatch(/switch the model to Claude/);
    const read = async () => (await tool(t, "get_settings", args)).data.llm.provider;
    expect(await read()).toBe("gemini");
    const c = await tool(t, "confirm_settings_change", {
      ...args,
      confirmationToken: p.data.confirmationToken,
    });
    expect(c.data.status).toBe("changed");
    expect(await read()).toBe("claude");
  });

  it("refuses a confirmation from someone else, a forged token or an expired one", async () => {
    let clock = Date.parse("2026-11-17T10:00:00Z");
    const t = setup({ product: { claude: "ck" }, now: () => new Date(clock) });
    const id = await t.room();
    await t.call("POST", "/v1/tokens", { roomId: id, userId: "guest-2", displayName: "G" });
    const args = { roomId: id, actorUserId: "host-1" };
    const p = await tool(t, "propose_settings_change", { ...args, llm: "claude" });
    const token = p.data.confirmationToken as string;
    const other = await tool(t, "confirm_settings_change", {
      roomId: id,
      actorUserId: "guest-2",
      confirmationToken: token,
    });
    expect(other.isError).toBe(true);
    const forged = await tool(t, "confirm_settings_change", {
      ...args,
      confirmationToken: token.replace(/.$/, (ch) => (ch === "a" ? "b" : "a")),
    });
    expect(forged.isError).toBe(true);
    clock += 3 * 60_000;
    expect(
      (await tool(t, "confirm_settings_change", { ...args, confirmationToken: token })).isError,
    ).toBe(true);
    expect((await tool(t, "get_settings", args)).data.llm.provider).toBe("gemini");
  });

  it("only the host proposes; a token for one room does not work in another", async () => {
    const t = setup({ product: { claude: "ck" } });
    const a = await t.room();
    const b = await t.room();
    await t.call("POST", "/v1/tokens", { roomId: a, userId: "m", displayName: "M" });
    expect(
      (await tool(t, "propose_settings_change", { roomId: a, actorUserId: "m", llm: "claude" }))
        .isError,
    ).toBe(true);
    const p = await tool(t, "propose_settings_change", {
      roomId: a,
      actorUserId: "host-1",
      llm: "claude",
    });
    const r = await tool(t, "confirm_settings_change", {
      roomId: b,
      actorUserId: "host-1",
      confirmationToken: p.data.confirmationToken,
    });
    expect(r.isError).toBe(true);
  });

  it("validates the key at proposal time", async () => {
    const t = setup({ product: {} });
    const id = await t.room();
    const p = await tool(t, "propose_settings_change", {
      roomId: id,
      actorUserId: "host-1",
      llm: "openai",
    });
    expect(p.isError).toBe(true);
    expect(p.text).toMatch(/key/i);
  });
});
