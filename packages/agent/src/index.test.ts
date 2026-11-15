import { describe, expect, it } from "vitest";
import { agentName } from "./index.js";

describe("@openblah/agent", () => {
  it("exports its name", () => {
    expect(agentName()).toBe("@openblah/agent");
  });
});
