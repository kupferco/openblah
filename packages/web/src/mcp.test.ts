import { describe, expect, it, vi } from "vitest";
import { connectMcpInBrowser } from "./mcp.js";

describe("connectMcpInBrowser", () => {
  it("opens the popup first, points it at the consent page and closes it", async () => {
    const popup = { location: { href: "" }, closed: false, close: vi.fn() };
    const open = vi.fn(() => popup) as never;
    const client = {
      connectMcpServer: vi.fn(
        async (_url: string, o: { openAuthorization: (u: string) => void }) => {
          expect(open).toHaveBeenCalled(); // before any network work
          o.openAuthorization("https://as/auth");
          return { id: "mc_1" } as never;
        },
      ),
    };
    await connectMcpInBrowser(client, "https://mcp.example/mcp", { open });
    expect(popup.location.href).toBe("https://as/auth");
    expect(popup.close).toHaveBeenCalled();
  });

  it("explains a blocked popup", async () => {
    const client = { connectMcpServer: vi.fn() };
    await expect(connectMcpInBrowser(client, "u", { open: (() => null) as never })).rejects.toThrow(
      /blocked/,
    );
    expect(client.connectMcpServer).not.toHaveBeenCalled();
  });
});
