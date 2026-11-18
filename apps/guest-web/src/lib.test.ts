import { describe, expect, it, vi } from "vitest";
import { OpenBlahApiError } from "@openblah/web";
import {
  checkBrowserSupport,
  classifyError,
  historyAvailable,
  levelFromSamples,
  micErrorState,
  tokenFromPath,
} from "./lib.js";

describe("tokenFromPath", () => {
  it("reads the token from /j/<token>", () => {
    expect(tokenFromPath("/j/abc123")).toBe("abc123");
    expect(tokenFromPath("/j/abc123/")).toBe("abc123");
  });
  it("rejects other paths", () => {
    expect(tokenFromPath("/")).toBeNull();
    expect(tokenFromPath("/x/abc")).toBeNull();
    expect(tokenFromPath("/j/a/b")).toBeNull();
    expect(tokenFromPath("/j/%E0%A4%A")).toBeNull();
  });
});

describe("checkBrowserSupport", () => {
  it("needs WebRTC and a microphone API in a secure context", () => {
    expect(checkBrowserSupport({ RTCPeerConnection: class {}, mediaDevices: {} }).ok).toBe(true);
    expect(checkBrowserSupport({ mediaDevices: {} }).ok).toBe(false);
    expect(checkBrowserSupport({ RTCPeerConnection: class {} }).ok).toBe(false);
    expect(
      checkBrowserSupport({ RTCPeerConnection: class {}, mediaDevices: {}, isSecureContext: false })
        .ok,
    ).toBe(false);
  });
});

describe("classifyError", () => {
  it("maps 404 and the server message to invalid", () => {
    expect(classifyError(new OpenBlahApiError(404, "invite is not valid", null))).toBe("invalid");
    expect(classifyError("invite is not valid")).toBe("invalid");
  });
  it("maps fetch failures to network", () => {
    expect(classifyError(new TypeError("x"))).toBe("network");
    expect(classifyError("Failed to fetch")).toBe("network");
  });
  it("maps the rest to other", () => {
    expect(classifyError(new OpenBlahApiError(500, "boom", null))).toBe("other");
  });
});

describe("mic helpers", () => {
  it("tells a blocked mic from a missing one", () => {
    expect(micErrorState({ name: "NotAllowedError" })).toBe("blocked");
    expect(micErrorState({ name: "NotFoundError" })).toBe("missing");
  });
  it("computes a level", () => {
    expect(levelFromSamples(new Uint8Array(64).fill(128))).toBe(0);
    expect(levelFromSamples(Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 255 : 0)))).toBe(1);
    expect(levelFromSamples(new Uint8Array(0))).toBe(0);
  });
});

describe("historyAvailable", () => {
  it("is true only for a 2xx answer", async () => {
    const ok = vi.fn(async () => new Response(null, { status: 200 }));
    expect(await historyAvailable("https://s/v1/", "t k", ok)).toBe(true);
    expect(ok).toHaveBeenCalledWith("https://s/v1/invites/t%20k/history", { method: "HEAD" });
    expect(
      await historyAvailable("https://s/v1", "t", async () => new Response(null, { status: 404 })),
    ).toBe(false);
    expect(
      await historyAvailable("https://s/v1", "t", async () => {
        throw new TypeError("offline");
      }),
    ).toBe(false);
  });
});
