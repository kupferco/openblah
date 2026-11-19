/**
 * Local run: fake MCP server + the voice routes, with a stub login.
 *   OPENBLAH_URL=... OPENBLAH_API_KEY=... node --experimental-strip-types src/server.ts
 * Needs a running OpenBlah server (see docs/deploy.md). Housekeeper's real backend replaces `authenticate`.
 */
import { createServer } from "node:http";
import { createFakeMcpServer } from "./fake-mcp.js";
import { createVoiceRoutes, toNodeListener } from "./voice-routes.js";

const mcp = createFakeMcpServer({ "demo-token": "demo-user" });
const mcpUrl = await mcp.start();
const handler = createVoiceRoutes({
  openblahUrl: process.env.OPENBLAH_URL ?? "http://localhost:8080",
  openblahApiKey: process.env.OPENBLAH_API_KEY ?? "dev-key",
  mcpUrl,
  authenticate: async (req) =>
    req.headers.get("authorization") === "Bearer demo-token"
      ? { id: "demo-user", displayName: "Demo", mcpToken: "demo-token" }
      : null,
});
createServer(toNodeListener(handler)).listen(3000, () =>
  console.log(`voice routes on :3000 (fake MCP at ${mcpUrl})`),
);
