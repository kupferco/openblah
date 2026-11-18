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
