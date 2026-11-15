import { describe, expect, it } from "vitest";
import { guestWebName } from "./index.js";

describe("@openblah/guest-web", () => {
  it("exports its name", () => {
    expect(guestWebName()).toBe("@openblah/guest-web");
  });
});
