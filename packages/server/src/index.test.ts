import { describe, expect, it } from "vitest";
import { serverName } from "./index.js";

describe("@openblah/server", () => {
  it("exports its name", () => {
    expect(serverName()).toBe("@openblah/server");
  });
});
