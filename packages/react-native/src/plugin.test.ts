import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const plugin = require("../plugin/index.js") as {
  applyIosInfoPlist: (plist: Record<string, unknown>, mic: string) => Record<string, unknown>;
  ANDROID_PERMISSIONS: string[];
  interopDefault: (mod: unknown) => unknown;
};
type Config = { name: string; slug: string; _internal?: { projectRoot: string } };
const withOpenBlah = plugin as unknown as (config: Config, options?: object) => Config;

describe("config plugin", () => {
  it("adds the audio background mode once and keeps other modes", () => {
    const plist = plugin.applyIosInfoPlist({ UIBackgroundModes: ["fetch", "audio"] }, "mic");
    expect(plist.UIBackgroundModes).toEqual(["fetch", "audio"]);
    expect(plugin.applyIosInfoPlist({}, "mic").UIBackgroundModes).toEqual(["audio"]);
  });

  it("sets the microphone text without overwriting an existing one", () => {
    expect(plugin.applyIosInfoPlist({}, "mine").NSMicrophoneUsageDescription).toBe("mine");
    expect(
      plugin.applyIosInfoPlist({ NSMicrophoneUsageDescription: "theirs" }, "mine")
        .NSMicrophoneUsageDescription,
    ).toBe("theirs");
  });

  it("requests the audio permissions", () => {
    expect(plugin.ANDROID_PERMISSIONS).toContain("android.permission.RECORD_AUDIO");
  });

  it("is a function Expo can run", () => {
    expect(typeof (plugin as unknown)).toBe("function");
  });

  it("unwraps ES module default exports from required plugins", () => {
    const fn = () => 1;
    expect(plugin.interopDefault({ default: fn })).toBe(fn);
    expect(plugin.interopDefault(fn)).toBe(fn);
  });

  it("applies its sub-plugins without a PluginError", () => {
    const config = withOpenBlah(
      { name: "t", slug: "t", _internal: { projectRoot: process.cwd() } },
      { microphonePermission: "mic" },
    );
    expect(config.name).toBe("t");
  });
});
