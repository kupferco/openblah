import { describe, expect, it, vi } from "vitest";
import { createApp, HttpWorkerWaker, MemoryStorage } from "./index.js";
import type { LiveKitGateway, WorkerWaker } from "./index.js";

// The worker's port answers within a second of starting and registers with LiveKit about
// twenty later; a dispatch sent in between is never delivered. These pin the wait.

const reply = (status: number) => new Response(status === 200 ? "ready" : "starting", { status });

describe("HttpWorkerWaker.ready", () => {
  it("waits until the worker says it is registered", async () => {
    const answers = [503, 503, 200];
    const seen: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      seen.push(url);
      return reply(answers.shift() ?? 200);
    }) as unknown as typeof fetch;
    const waker = new HttpWorkerWaker("https://agent.test/", false, 1_000, fetchFn, 1);
    await expect(waker.ready(5_000)).resolves.toBe(true);
    expect(seen).toEqual([
      "https://agent.test/ready",
      "https://agent.test/ready",
      "https://agent.test/ready",
    ]);
  });

  it("gives up after the timeout and says so", async () => {
    const fetchFn = vi.fn(async () => reply(503)) as unknown as typeof fetch;
    const waker = new HttpWorkerWaker("https://agent.test", false, 1_000, fetchFn, 1);
    await expect(waker.ready(20)).resolves.toBe(false);
  });

  it("treats a worker that is not answering yet as not ready", async () => {
    let n = 0;
    const fetchFn = vi.fn(async () => {
      if (n++ < 2) throw new Error("connection refused");
      return reply(200);
    }) as unknown as typeof fetch;
    const waker = new HttpWorkerWaker("https://agent.test", false, 1_000, fetchFn, 1);
    await expect(waker.ready(5_000)).resolves.toBe(true);
  });
});

describe("tap-to-start", () => {
  it("dispatches only after the worker is ready", async () => {
    const order: string[] = [];
    const livekit: LiveKitGateway = {
      createRoom: vi.fn(async () => {}),
      updateRoomMetadata: vi.fn(async () => {}),
      deleteRoom: vi.fn(async () => {}),
      removeParticipant: vi.fn(async () => {}),
      stopAgent: vi.fn(async () => {}),
      sendData: vi.fn(async () => {}),
      dispatchAgent: vi.fn(async () => {
        order.push("dispatch");
        return { dispatchId: "AD_1", created: true };
      }),
      createToken: vi.fn(async (r) => `tok:${r.userId}`),
    };
    const worker: WorkerWaker = {
      wake: vi.fn(async () => {
        order.push("wake");
        return true;
      }),
      ready: vi.fn(async () => {
        order.push("ready");
        return true;
      }),
    };
    const app = createApp({ storage: new MemoryStorage(), livekit, apiKeys: ["k"], worker });
    const call = (path: string, body: unknown) =>
      app.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer k" },
        body: JSON.stringify(body),
      });
    const room = (await (
      await call("/v1/rooms", { hostUserId: "u", hostDisplayName: "Dani", agent: "on" })
    ).json()) as {
      id: string;
    };
    const res = await call(`/v1/rooms/${room.id}/agent`, {});
    expect(res.status).toBe(201);
    expect(order).toEqual(["wake", "ready", "dispatch"]);
  });
});
