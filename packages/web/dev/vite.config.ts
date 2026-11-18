import { defineConfig } from "vite";

const src = (p: string) => new URL(p, import.meta.url).pathname;

// The page imports the package names, like an app would; they resolve to source here.
export default defineConfig({
  root: import.meta.dirname,
  server: { port: 5173 },
  resolve: {
    alias: [
      { find: /^@openblah\/web\/react$/, replacement: src("../src/react.ts") },
      { find: /^@openblah\/web$/, replacement: src("../src/index.ts") },
      { find: /^@openblah\/core\/react$/, replacement: src("../../core/src/react.ts") },
      { find: /^@openblah\/core$/, replacement: src("../../core/src/index.ts") },
    ],
  },
});
