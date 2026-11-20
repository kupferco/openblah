import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { checkReleaseConfig } from "./check-release-config.mjs";

const root = new URL("..", import.meta.url).pathname;

describe("release config", () => {
  it("is structurally valid (app.json, eas.json, AASA, assetlinks, firebase.json)", () => {
    const { errors } = checkReleaseConfig(root);
    expect(errors).toEqual([]);
  });

  it("flags the placeholders the owner still has to fill in", () => {
    const { placeholders } = checkReleaseConfig(root);
    expect(placeholders.map((p) => p.value)).toContain("APPLE_TEAM_ID.dev.openblah.app");
  });

  it("--release prints a viber-manual marker while placeholders remain", () => {
    const r = spawnSync("node", ["scripts/check-release-config.mjs", "--release"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^::viber-manual::\{.*"verify".*\}$/m);
    expect(
      execFileSync("node", ["scripts/check-release-config.mjs"], { cwd: root, encoding: "utf8" }),
    ).toContain("config ok");
  });
});
