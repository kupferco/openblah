import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Linking: { openURL: vi.fn(async () => {}) } }));

import { Linking } from "react-native";
import { connectMcpInApp } from "./mcp.js";

type Opts = { openAuthorization: (u: string) => unknown; isCancelled?: () => boolean };

describe("connectMcpInApp", () => {
  it("opens the system browser by default", async () => {
    const client = {
      connectMcpServer: vi.fn(async (_u: string, o: Opts) => {
        await o.openAuthorization("https://as/auth");
        return { id: "mc_1" } as never;
      }),
    };
    await connectMcpInApp(client, "https://mcp.example/mcp");
    expect(Linking.openURL).toHaveBeenCalledWith("https://as/auth");
  });

  it("treats a dismissed in-app sheet as cancelled", async () => {
    const openAuthSession = vi.fn(async () => ({ type: "dismiss" }));
    let cancelled: boolean | undefined;
    const client = {
      connectMcpServer: vi.fn(async (_u: string, o: Opts) => {
        o.openAuthorization("https://as/auth");
        await Promise.resolve();
        cancelled = o.isCancelled?.();
        return { id: "mc_1" } as never;
      }),
    };
    await connectMcpInApp(client, "u", { openAuthSession });
    expect(openAuthSession).toHaveBeenCalledWith("https://as/auth");
    expect(cancelled).toBe(true);
  });
});
