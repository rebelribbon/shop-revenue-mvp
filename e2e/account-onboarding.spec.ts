import { expect, test } from "@playwright/test";
import { E2E_PASSWORD, waitForEmail, completeBusinessBasics } from "./helpers";
import { auditUX } from "./ux-audit";
test("public homepage and signup stay readable at narrow phone widths", async ({
  page,
}) => {
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /Run your business/ }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const label = page.getByText("Appointments", { exact: true }).first();
    expect(
      await label.evaluate((e) => e.getBoundingClientRect().height),
    ).toBeLessThan(32);
  }
  await page.goto("/sign-up");
  await page.getByLabel("Create a password", { exact: true }).fill("short");
  await expect(
    page.getByRole("button", { name: "Create login", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Create a password", { exact: true })
    .fill(E2E_PASSWORD);
  await auditUX(page);
});
test("recovery link survives a preview and resets on a fresh browser context", async ({
  page,
  browser,
}) => {
  const email = `recovery-${Date.now()}@example.test`;
  await page.goto("/sign-up");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Create a password", { exact: true })
    .fill(E2E_PASSWORD);
  const since = Date.now();
  await page.getByRole("button", { name: "Create login", exact: true }).click();
  const confirmation = await waitForEmail(
    email,
    since,
    /http:\/\/localhost:3000\/auth\/confirm\?[^\s"'<>]+/,
  );
  await page.goto(confirmation);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.request.post("/auth/sign-out");
  await page.goto("/forgot-password");
  await page.getByLabel("Email", { exact: true }).fill(email);
  const resetAt = Date.now();
  await page
    .getByRole("button", { name: "Send reset instructions", exact: true })
    .click();
  const reset = await waitForEmail(
    email,
    resetAt,
    /http:\/\/localhost:3000\/auth\/confirm\?[^\s"'<>]+/,
  );
  const fresh = await browser.newContext();
  const phone = await fresh.newPage();
  // GET and reload model mail scanner and preview fetches; neither consumes OTP.
  await phone.goto(reset);
  await phone.reload();
  await expect(
    phone.getByRole("button", { name: "Continue", exact: true }),
  ).toBeVisible();
  await phone.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(phone).toHaveURL(/\/reset-password/);
  const updated = E2E_PASSWORD + "Changed";
  await phone.getByLabel("New password", { exact: true }).fill(updated);
  await phone.getByLabel("Confirm password", { exact: true }).fill(updated);
  await phone
    .getByRole("button", { name: "Save password", exact: true })
    .click();
  await phone.request.post("/auth/sign-out");
  await phone.goto(reset);
  await phone.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(phone).toHaveURL(/\/forgot-password\?error=link/);
  await phone.goto("/sign-in?next=/start");
  await phone.getByLabel("Email", { exact: true }).fill(email);
  await phone.getByLabel("Password", { exact: true }).fill(updated);
  await phone.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(phone).toHaveURL(/\/start$/);
  await fresh.close();
});
test("email second step protects records and exported data @mfa", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_MFA !== "true",
    "Dedicated enforced-security server",
  );
  const email = `email-step-${Date.now()}@example.test`;
  await page.goto("/sign-up");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Create a password", { exact: true })
    .fill(E2E_PASSWORD);
  const confirmAt = Date.now();
  await page.getByRole("button", { name: "Create login", exact: true }).click();
  const confirmationCode = await waitForEmail(email, confirmAt, /\b\d{6}\b/);
  await page
    .getByLabel("Confirmation code", { exact: true })
    .fill(confirmationCode);
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page).toHaveURL(/\/verify\?next=/);
  await page
    .getByRole("link", { name: "Sign in with your password", exact: true })
    .click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/verify\?next=/);
  expect(
    (await page.request.get("/app/settings/export/customers")).status(),
  ).toBe(403);
  const since = Date.now();
  await page
    .getByRole("button", { name: "Send verification code", exact: true })
    .click();
  const code = await waitForEmail(email, since, /\b\d{6}\b/);
  await page.getByLabel("Email verification code").fill(code);
  await page
    .getByRole("button", { name: "Verify and continue", exact: true })
    .click();
  await expect(page).toHaveURL(/\/start$/);
  await completeBusinessBasics(page, "Email Owner", "Email Verification Shop");
  expect(
    (await page.request.get("/app/settings/export/customers")).status(),
  ).toBe(200);
  await page.request.post("/auth/sign-out");
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in/);
});
