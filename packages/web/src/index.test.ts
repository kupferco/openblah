import { describe, expect, it } from "vitest";
import { webName } from "./index.js";

describe("@openblah/web", () => {
  it("exports its name", () => {
    expect(webName()).toBe("@openblah/web");
  });
});
