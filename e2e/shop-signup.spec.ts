import { expect, test } from "@playwright/test";
import { auditUX } from "./ux-audit";
import { E2E_PASSWORD } from "./helpers";

test("a new owner creates their own isolated shop and reaches subscription billing", async ({
  page,
}, info) => {
  test.skip(
    process.env.PUBLIC_SIGNUP_ENABLED !== "true",
    "Self-service signup is gated until billing is configured.",
  );
  const stamp = `${info.project.name}-${Date.now()}`;
  await page.goto("/sign-up");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`new-owner-${stamp}@example.test`);
  await page
    .getByLabel("Create a password", { exact: true })
    .fill(E2E_PASSWORD);
  await auditUX(page);
  await page.getByRole("button", { name: "Create login", exact: true }).click();
  await expect
    .poll(
      async () =>
        page.url().endsWith("/start") ||
        (await page
          .getByRole("link", {
            name: "Continue to set up your shop",
            exact: true,
          })
          .isVisible()),
    )
    .toBe(true);
  if (!page.url().endsWith("/start"))
    await page
      .getByRole("link", { name: "Continue to set up your shop", exact: true })
      .click();
  await expect(page).toHaveURL(/\/start$/);
  await page.getByLabel("Your name", { exact: true }).fill("New Owner");
  await page
    .getByLabel("Shop name", { exact: true })
    .fill(`Independent Shop ${stamp}`);
  await auditUX(page);
  await page.screenshot({
    path: `test-results/owner-signup-${info.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: "Create shop and continue to billing",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/app\/settings\/billing$/);
  await expect(
    page.getByRole("heading", { name: "Billing", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(`Independent Shop ${stamp}`, { exact: true }).first(),
  ).toBeVisible();
  await page.goto("/app/customers");
  await expect(page.getByText("Ford", { exact: true })).toHaveCount(0);
  await page.goto("/start");
  await expect(page).toHaveURL(/\/app\/settings\/billing$/);
});
