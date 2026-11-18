import { defineConfig } from "@playwright/test";

// Smoke test against a mocked server (requests are intercepted in the test).
export default defineConfig({
  testDir: "e2e",
  webServer: {
    command: "pnpm exec vite --port 5174",
    url: "http://localhost:5174",
    reuseExistingServer: true,
  },
  use: {
    baseURL: "http://localhost:5174",
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
    permissions: ["microphone"],
  },
});
