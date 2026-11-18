import { describe, expect, it, vi } from "vitest";
import { holdWakeLock, inAppBrowserName, isMobileUserAgent } from "./mobile.js";

describe("mobile helpers", () => {
  it("detects phones and in-app browsers", () => {
    expect(isMobileUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")).toBe(true);
    expect(isMobileUserAgent("Mozilla/5.0 (X11; Linux x86_64) Chrome/120")).toBe(false);
    expect(inAppBrowserName("Mozilla/5.0 (iPhone) [FBAN/FBIOS;FBAV/1]")).toBe("FBAN");
    expect(inAppBrowserName("Mozilla/5.0 Safari/604")).toBeNull();
  });

  it("holds the wake lock, re-requests it when visible again, and releases it", async () => {
    const release = vi.fn(async () => {});
    const request = vi.fn(async () => ({ release }));
    const listeners: Array<() => void> = [];
    const doc = {
      visibilityState: "visible",
      addEventListener: (_: string, f: () => void) => listeners.push(f),
      removeEventListener: vi.fn(),
    } as unknown as Document;
    const h = holdWakeLock({ wakeLock: { request } }, doc);
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    listeners[0]!();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    h.release();
    expect(release).toHaveBeenCalled();
  });

  it("does not fail when wake lock is missing or denied", async () => {
    const doc = {
      visibilityState: "visible",
      addEventListener() {},
      removeEventListener() {},
    } as unknown as Document;
    expect(() => holdWakeLock({}, doc).release()).not.toThrow();
    const h = holdWakeLock(
      {
        wakeLock: {
          request: async () => {
            throw new Error("denied");
          },
        },
      },
      doc,
    );
    await Promise.resolve();
    expect(() => h.release()).not.toThrow();
  });
});
