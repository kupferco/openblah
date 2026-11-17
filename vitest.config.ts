import { defineConfig } from "vitest/config";

// Workspace packages are resolved to source so tests do not need a prior build.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@openblah\/web\/react$/,
        replacement: new URL("packages/web/src/react.ts", import.meta.url).pathname,
      },
      {
        find: /^@openblah\/web$/,
        replacement: new URL("packages/web/src/index.ts", import.meta.url).pathname,
      },
      {
        find: /^@openblah\/core\/react$/,
        replacement: new URL("packages/core/src/react.ts", import.meta.url).pathname,
      },
      {
        find: /^@openblah\/core$/,
        replacement: new URL("packages/core/src/index.ts", import.meta.url).pathname,
      },
    ],
  },
  test: { include: ["{packages,apps}/*/src/**/*.test.{ts,tsx}"] },
});
