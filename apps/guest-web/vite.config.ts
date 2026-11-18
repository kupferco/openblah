import { defineConfig } from "vite";

// The page lives at /j/<token>; unknown paths fall back to index.html in dev.
export default defineConfig(({ command }) => ({
  // Served under /guest/ in the Vercel build (apps/landing/vercel.json rewrites /j/* to it).
  base: command === "build" ? "/guest/" : "/",
  server: { port: 5174 },
  resolve: {
    alias: [
      {
        find: /^@openblah\/web\/react$/,
        replacement: new URL("../../packages/web/src/react.ts", import.meta.url).pathname,
      },
      {
        find: /^@openblah\/web$/,
        replacement: new URL("../../packages/web/src/index.ts", import.meta.url).pathname,
      },
      {
        find: /^@openblah\/core\/react$/,
        replacement: new URL("../../packages/core/src/react.ts", import.meta.url).pathname,
      },
      {
        find: /^@openblah\/core$/,
        replacement: new URL("../../packages/core/src/index.ts", import.meta.url).pathname,
      },
    ],
  },
}));
