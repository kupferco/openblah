import { describe, expect, it } from "vitest";
import { parseInviteLink } from "./invite-link.js";

describe("parseInviteLink", () => {
  it("reads the token from the universal link and the custom scheme", () => {
    expect(parseInviteLink("https://openblah.web.app/j/abcDEF123456")).toBe("abcDEF123456");
    expect(parseInviteLink("https://openblah.web.app/j/abcDEF123456/?x=1")).toBe("abcDEF123456");
    expect(parseInviteLink("openblah://j/abcDEF123456")).toBe("abcDEF123456");
  });
  it("ignores other hosts, paths and sign-in links", () => {
    expect(parseInviteLink("https://evil.example/j/abcDEF123456")).toBeNull();
    expect(parseInviteLink("https://openblah.web.app/")).toBeNull();
    expect(parseInviteLink("https://openblah.web.app/j/short")).toBeNull();
    expect(parseInviteLink("https://openblah.web.app/__/auth/links?oobCode=abc")).toBeNull();
    expect(parseInviteLink("not a url")).toBeNull();
  });
});
