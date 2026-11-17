import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

/** Tools of the eval's fake MCP server. All read-only; results are canned. */
export function fakeMcpServer(): McpServer {
  const server = new McpServer({ name: "eval-fake", version: "1.0.0" });
  const ro = { annotations: { readOnlyHint: true } };
  const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
  server.registerTool(
    "get_weather",
    {
      description: "Current weather and forecast for a city.",
      inputSchema: { city: z.string().describe("City name") },
      ...ro,
    },
    async ({ city }) => text(`Sunny, 24 degrees in ${city}`),
  );
  server.registerTool(
    "list_events",
    {
      description: "List the user's calendar events on a date.",
      inputSchema: { date: z.string().describe("Date as YYYY-MM-DD") },
      ...ro,
    },
    async ({ date }) => text(`No events on ${date}`),
  );
  server.registerTool(
    "find_restaurants",
    {
      description: "Search restaurants by cuisine in a city.",
      inputSchema: {
        cuisine: z.string(),
        city: z.string(),
        max_results: z.number().int().optional(),
      },
      ...ro,
    },
    async ({ city }) => text(`Three places in ${city}`),
  );
  server.registerTool(
    "get_stock_price",
    {
      description: "Latest price for a stock ticker symbol.",
      inputSchema: { symbol: z.string().describe("Ticker, e.g. AAPL") },
      ...ro,
    },
    async ({ symbol }) => text(`${symbol} is at 100`),
  );
  server.registerTool(
    "convert_currency",
    {
      description: "Convert an amount between currencies (ISO codes).",
      inputSchema: {
        amount: z.number(),
        from: z.string().describe("ISO code"),
        to: z.string().describe("ISO code"),
      },
      ...ro,
    },
    async ({ amount, to }) => text(`${amount * 6} ${to}`),
  );
  return server;
}

/** Serve the fake MCP server on a random local port (stateless Streamable HTTP). */
export async function startFakeMcp(): Promise<{ url: string; close(): Promise<void> }> {
  const http: Server = createServer(async (req, res) => {
    const server = fakeMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => void transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`,
    close: () =>
      new Promise<void>((r) => {
        http.closeAllConnections();
        http.close(() => r());
      }),
  };
}
