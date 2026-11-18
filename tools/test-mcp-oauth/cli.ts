import { startTestMcpOAuth } from "./server.js";

const port = Number(process.env.PORT ?? 4010);
const s = await startTestMcpOAuth({ port });
console.log(`Test MCP server with OAuth: add ${s.mcpUrl} as a server. Ctrl+C to stop.`);
