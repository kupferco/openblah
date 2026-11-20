import { defineConfig } from "vitest/config";

// Workspace packages are resolved to source so tests do not need a prior build.
export default defineConfig({
  resolve: {
    alias: [
      {
        // Native layer is not testable in node: the app tests use the core SDK through a shim.
        find: /^@openblah\/react-native$/,
        replacement: new URL("apps/app/src/test-support/sdk.ts", import.meta.url).pathname,
      },
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
  test: { include: ["{packages,apps,examples}/*/src/**/*.test.{ts,tsx}", "tools/*/*.test.ts"] },
});
