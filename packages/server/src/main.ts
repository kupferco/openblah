import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { createServerFromEnv } from "./config.js";
import { attachWatchSocket } from "./watch-socket.js";

const { app, watch } = createServerFromEnv();
const port = Number(process.env.PORT ?? 8080);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`openblah server listening on port ${info.port}`);
});
// The Apple Watch socket, only when OPENBLAH_WATCH_SECRET is set (docs/watch.md).
if (watch) attachWatchSocket(server as Server, watch);
