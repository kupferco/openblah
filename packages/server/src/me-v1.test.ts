import { describe, expect, it, vi } from "vitest";
import { createApp, MemoryStorage } from "./index.js";
import type { LiveKitGateway, TokenVerifier } from "./index.js";

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
  const verifier: TokenVerifier = {
    verify: async (t) =>
      t.startsWith("fb:") ? { uid: t.slice(3), email: `${t.slice(3)}@x.test` } : null,
  };
  const app = createApp({ storage, livekit, apiKeys: ["k"], verifier, agentSecret: "a" });
  const req = (method: string, path: string, token: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { storage, req };
}

async function startCall(req: ReturnType<typeof setup>["req"], uid = "u1") {
  const res = await req("POST", "/v1/me/calls", `fb:${uid}`, { displayName: "Ana" });
  return ((await res.json()) as { roomId: string }).roomId;
}

describe("standalone app users on the room routes", () => {
  it("lets the host use their ID token for invites, history settings and agent settings", async () => {
    const { req } = setup();
    const id = await startCall(req);
    expect(
      (await req("POST", `/v1/rooms/${id}/invites`, "fb:u1", { actorUserId: "u1" })).status,
    ).toBe(201);
    const hs = await req("PUT", `/v1/rooms/${id}/history-settings`, "fb:u1", {
      actorUserId: "u1",
      saveNotes: true,
    });
    expect(await hs.json()).toMatchObject({ saveNotes: true });
    expect(
      (
        await req("PUT", `/v1/rooms/${id}/agent`, "fb:u1", {
          actorUserId: "u1",
          anyoneCanAddAgent: true,
        })
      ).status,
    ).toBe(200);
    expect((await req("GET", `/v1/history?actorUserId=u1`, "fb:u1")).status).toBe(200);
  });

  it("refuses acting as someone else, or without naming themselves", async () => {
    const { req } = setup();
    const id = await startCall(req);
    const other = await req("POST", `/v1/rooms/${id}/invites`, "fb:u2", { actorUserId: "u1" });
    expect(other.status).toBe(403);
    expect((await req("GET", `/v1/history?actorUserId=u1`, "fb:u2")).status).toBe(403);
    expect((await req("GET", `/v1/history`, "fb:u1")).status).toBe(403);
    // A mixed request: own actor id but someone else's user id in the body.
    expect(
      (await req("POST", `/v1/rooms/${id}/invites`, "fb:u1", { actorUserId: "u1", userId: "u2" }))
        .status,
    ).toBe(403);
  });

  it("does not open product-level routes to ID tokens", async () => {
    const { req } = setup();
    const id = await startCall(req);
    const create = await req("POST", "/v1/rooms", "fb:u1", {
      hostUserId: "u1",
      hostDisplayName: "A",
    });
    expect(create.status).toBe(401);
    expect((await req("POST", "/v1/tokens", "fb:u1", { userId: "u1", roomId: id })).status).toBe(
      401,
    );
    expect((await req("GET", "/v1/product/settings", "fb:u1")).status).toBe(401);
    expect(
      (await req("POST", `/v1/rooms/${id}/agent/dispatch`, "fb:u1", { actorUserId: "u1" })).status,
    ).toBe(401);
    expect((await req("GET", `/v1/history?actorUserId=u1`, "bad")).status).toBe(401);
  });

  it("keeps the API key working as before", async () => {
    const { req } = setup();
    const id = await startCall(req);
    expect((await req("GET", `/v1/history?actorUserId=u1`, "k")).status).toBe(200);
    expect((await req("GET", `/v1/rooms/${id}`, "k")).status).toBe(200);
  });
});

describe("per-room MCP servers", () => {
  it("starts with all servers on, lets the host choose, and hides it from non-hosts", async () => {
    const { req, storage } = setup();
    const id = await startCall(req);
    const get = async () =>
      (
        (await (
          await req("GET", `/v1/rooms/${id}/mcp-servers?actorUserId=u1`, "fb:u1")
        ).json()) as {
          enabledConnectionIds: string[] | null;
        }
      ).enabledConnectionIds;
    expect(await get()).toBeNull();
    const put = await req("PUT", `/v1/rooms/${id}/mcp-servers`, "fb:u1", {
      actorUserId: "u1",
      enabledConnectionIds: ["a"],
    });
    expect(put.status).toBe(200);
    expect(await get()).toEqual(["a"]);
    expect((await storage.getRoom(id))?.mcp).toMatchObject({
      ownerId: "u1",
      enabledConnectionIds: ["a"],
    });
    await req("PUT", `/v1/rooms/${id}/mcp-servers`, "fb:u1", {
      actorUserId: "u1",
      enabledConnectionIds: null,
    });
    expect(await get()).toBeNull();
    expect(
      (
        await req("PUT", `/v1/rooms/${id}/mcp-servers`, "fb:u1", {
          actorUserId: "u1",
          enabledConnectionIds: "x",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req("PUT", `/v1/rooms/${id}/mcp-servers`, "fb:u2", {
          actorUserId: "u2",
          enabledConnectionIds: [],
        })
      ).status,
    ).toBe(403);
  });

  it("can start a call with a chosen set of servers", async () => {
    const { req, storage } = setup();
    const res = await req("POST", "/v1/me/calls", "fb:u1", {
      displayName: "Ana",
      mcpConnectionIds: ["a", "b"],
    });
    const { roomId } = (await res.json()) as { roomId: string };
    expect((await storage.getRoom(roomId))?.mcp).toMatchObject({
      enabledConnectionIds: ["a", "b"],
    });
    const bad = await req("POST", "/v1/me/calls", "fb:u1", {
      displayName: "A",
      mcpConnectionIds: [1],
    });
    expect(bad.status).toBe(400);
  });
});
