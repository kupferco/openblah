import { describe, expect, it } from "vitest";
import { reactNativeName } from "./index.js";

describe("@openblah/react-native", () => {
  it("exports its name", () => {
    expect(reactNativeName()).toBe("@openblah/react-native");
  });
});
