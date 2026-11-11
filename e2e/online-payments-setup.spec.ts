import { expect, test } from "@playwright/test";
import { signInWithPassword } from "./helpers";
import { auditUX } from "./ux-audit";

test("owner payment setup keeps the connection option visible and explains platform activation", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signInWithPassword(page, "owner.b@shop-b.test");
  await page.goto("/app/settings");
  await page.getByRole("link", { name: /Online payments/ }).click();
  await expect(page).toHaveURL(/\/app\/settings\/payments$/);
  await expect(
    page.getByRole("heading", { name: "Connect your Stripe account" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect Stripe", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect Stripe", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("status")).toContainText(
    "Shop Revenue is still activating",
  );
  await expect(page.getByText("Live payments", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open work", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Check setup status", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Check setup status", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("status")).toContainText(
    "There is nothing for you to change",
  );
  await auditUX(page, true);
  await page.screenshot({
    path: `test-results/online-payments-setup-${info.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Back to settings", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/settings$/);
  expect(errors).toEqual([]);
});
