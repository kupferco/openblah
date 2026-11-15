import { serve } from "@hono/node-server";
import { createAppFromEnv } from "./config.js";

const app = createAppFromEnv();
const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`openblah server listening on port ${info.port}`);
});
