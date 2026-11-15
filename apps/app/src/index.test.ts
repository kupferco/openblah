import { describe, expect, it } from "vitest";
import { appName } from "./index.js";

describe("@openblah/app", () => {
  it("exports its name", () => {
    expect(appName()).toBe("@openblah/app");
  });
});
