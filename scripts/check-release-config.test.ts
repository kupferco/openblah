import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { checkReleaseConfig } from "./check-release-config.mjs";

const root = new URL("..", import.meta.url).pathname;
const run = (...args: string[]) =>
  spawnSync("node", ["scripts/check-release-config.mjs", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, APPLE_TEAM_ID: "", APP_STORE_CONNECT_APP_ID: "", EXPO_TOKEN: "" },
  });

describe("release config", () => {
  it("passes for the free-account build with no Apple team, App Store Connect id or EAS secrets", () => {
    expect(checkReleaseConfig(root)).toEqual({ errors: [], placeholders: [] });
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("config ok");
  });

  it("keeps paid-only capabilities out of the default app.json", async () => {
    const { default: app } = await import("../apps/app/app.json");
    expect(app.expo.ios).not.toHaveProperty("associatedDomains");
    expect(app.expo.ios).not.toHaveProperty("usesAppleSignIn");
    expect(app.expo.plugins).not.toContain("expo-apple-authentication");
  });

  it("--paid checks the paid pieces behind the flag and flags the placeholders", () => {
    const { errors, placeholders } = checkReleaseConfig(root, { paid: true });
    expect(errors).toEqual([]);
    expect(placeholders.map((p) => p.value)).toContain("APPLE_TEAM_ID.dev.openblah.app");
  });

  it("--paid --release prints a viber-manual marker while placeholders remain", () => {
    const r = run("--paid", "--release");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^::viber-manual::\{.*"verify".*\}$/m);
  });
});
