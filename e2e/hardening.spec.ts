import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./helpers";
import { totp } from "./totp";
test("owner can download tenant records while staff and anonymous users cannot", async ({
  page,
}, info) => {
  expect(
    (await page.request.get("/app/settings/export/customers")).status(),
  ).toBe(403);
  await signInWithPassword(page, "owner.a@shop-a.test");
  await page.goto("/app/settings/export");
  await expect(
    page.getByRole("heading", { name: "Export shop data", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/hardening-export-${info.project.name}.png`,
    fullPage: true,
  });
  const result = await page.request.get("/app/settings/export/customers");
  expect(result.status()).toBe(200);
  expect(result.headers()["content-type"]).toContain("application/x-ndjson");
  expect(result.headers()["cache-control"]).toContain("no-store");
  const text = await result.text();
  expect(text).not.toContain("tokenHash");
  expect(JSON.parse(text.split("\n")[0]).format).toBe("shop-revenue-ndjson-v1");
  await page.request.post("/auth/sign-out");
  await signInWithPassword(page, "staff.a@shop-a.test");
  expect(
    (await page.request.get("/app/settings/export/customers")).status(),
  ).toBe(403);
  await page.goto("/app/settings/export");
  await expect(page).toHaveURL(/\/app\?denied=1/);
  expect((await page.request.get("/api/cron/maintenance")).status()).toBe(503);
});
test("authenticator enrollment verifies an actual local-stack TOTP code", async ({
  page,
}) => {
  await signInWithPassword(page, "owner.b@shop-b.test");
  await page.goto("/verify?next=/app/settings");
  const setup = page.getByRole("button", {
    name: "Set up authenticator",
    exact: true,
  });
  // The local stack is shared by both viewport projects. The first project enrolls;
  // the second verifies that the previously enrolled factor requires a code.
  if (await setup.count()) {
    await setup.click();
    await expect(
      page.getByAltText("Authenticator enrollment QR code"),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByAltText("Authenticator enrollment QR code")
          .evaluate((el) => (el as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.getByText("Enter setup key manually", { exact: true }).click();
    const secret = (await page.locator("code").textContent())!;
    await page.getByLabel("Authenticator code").fill(totp(secret));
    await page
      .getByRole("button", { name: "Verify authenticator", exact: true })
      .click();
    await expect(page).toHaveURL(/\/app\/settings$/);
  } else await expect(page.getByLabel("Authenticator code")).toBeVisible();
});
