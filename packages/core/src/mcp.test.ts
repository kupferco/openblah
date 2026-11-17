import { describe, expect, it, vi } from "vitest";
import { connectMcpServer, McpConnectError } from "./mcp.js";
import type { McpConnection } from "./api.js";

const conn = (status: McpConnection["status"], error?: string): McpConnection => ({
  id: "mc_1",
  serverUrl: "https://mcp.example/mcp",
  name: "mcp.example",
  status,
  ...(error ? { error } : {}),
  createdAt: "2026-01-01T00:00:00Z",
});

function fakeApi(statuses: McpConnection[]) {
  const queue = [...statuses];
  return {
    startMcpConnection: vi.fn(async () => ({ id: "mc_1", authorizationUrl: "https://as/auth" })),
    getMcpConnection: vi.fn(async () => queue.shift() ?? (statuses.at(-1) as McpConnection)),
    disconnectMcp: vi.fn(async () => {}),
  };
}
const sleep = async () => {};

describe("connectMcpServer", () => {
  it("opens the consent page and resolves when connected", async () => {
    const api = fakeApi([conn("pending"), conn("connected")]);
    const open = vi.fn();
    const r = await connectMcpServer(api, "https://mcp.example/mcp", {
      userId: "u1",
      scope: "read",
      openAuthorization: open,
      sleep,
    });
    expect(open).toHaveBeenCalledWith("https://as/auth");
    expect(api.startMcpConnection).toHaveBeenCalledWith("https://mcp.example/mcp", {
      userId: "u1",
      scope: "read",
    });
    expect(r.status).toBe("connected");
    expect(api.disconnectMcp).not.toHaveBeenCalled();
  });

  it("rejects with the reason when the sign-in is refused", async () => {
    const api = fakeApi([conn("error", "Sign-in was cancelled or refused.")]);
    await expect(
      connectMcpServer(api, "u", { openAuthorization: vi.fn(), sleep }),
    ).rejects.toMatchObject({ reason: "refused", message: "Sign-in was cancelled or refused." });
  });

  it("cancels and removes the attempt when the window is closed, after one last check", async () => {
    const api = fakeApi([conn("pending")]);
    const err = await connectMcpServer(api, "u", {
      openAuthorization: vi.fn(),
      isCancelled: () => true,
      sleep,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpConnectError);
    expect((err as McpConnectError).reason).toBe("cancelled");
    expect(api.getMcpConnection).toHaveBeenCalledTimes(1);
    expect(api.disconnectMcp).toHaveBeenCalledWith("mc_1", undefined);
  });

  it("times out", async () => {
    const api = fakeApi([conn("pending")]);
    await expect(
      connectMcpServer(api, "u", { openAuthorization: vi.fn(), timeoutMs: 0, sleep }),
    ).rejects.toMatchObject({ reason: "timeout" });
    expect(api.disconnectMcp).toHaveBeenCalled();
  });
});
