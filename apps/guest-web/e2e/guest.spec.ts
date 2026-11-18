import { expect, test } from "@playwright/test";

const preview = {
  hostDisplayName: "Alex",
  agent: "on",
  agentName: "Blah",
  consent: { version: "v1", text: "Blah will listen and take notes." },
};

test("guest sees the invite, consent and mic check", async ({ page }) => {
  await page.route("**/v1/invites/good", (r) => r.fulfill({ json: preview }));
  await page.goto("/j/good");
  await expect(page.getByText("Alex")).toBeVisible();
  await expect(page.getByText("Blah will listen and take notes.")).toBeVisible();

  const join = page.getByRole("button", { name: "Join call" });
  await expect(join).toBeDisabled();
  await page.getByLabel("Your name").fill("Sam");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Check my microphone" }).click();
  await expect(page.getByRole("meter")).toBeVisible();
  await expect(join).toBeEnabled();
});

test("an invalid link shows a friendly state", async ({ page }) => {
  await page.route("**/v1/invites/bad", (r) =>
    r.fulfill({ status: 404, json: { error: "invite is not valid" } }),
  );
  await page.goto("/j/bad");
  await expect(page.getByText("This link doesn't work")).toBeVisible();
});

test.describe("mobile widths", () => {
  for (const [label, width, height] of [
    ["iPhone SE", 320, 568],
    ["iPhone 14", 390, 844],
  ] as const) {
    test(`${label}: no sideways scroll, touch-size controls`, async ({ browser }) => {
      const ctx = await browser.newContext({
        viewport: { width, height },
        hasTouch: true,
        isMobile: true,
        permissions: ["microphone"],
      });
      const page = await ctx.newPage();
      await page.route("**/v1/invites/good", (r) => r.fulfill({ json: preview }));
      await page.goto("/j/good");
      await expect(page.getByText("Alex")).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      for (const b of [
        page.getByRole("button", { name: "Check my microphone" }),
        page.getByRole("button", { name: "Join call" }),
        page.getByLabel("Your name"),
      ]) {
        const box = await b.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      await ctx.close();
    });
  }
});

test("a browser that cannot join gets a clear note", async ({ browser }) => {
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) [FBAN/FBIOS;FBAV/400]",
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  });
  await page.goto("/j/good");
  await expect(page.getByText("This browser can't join")).toBeVisible();
  await expect(page.getByText(/in-app browser/)).toBeVisible();
  await ctx.close();
});
