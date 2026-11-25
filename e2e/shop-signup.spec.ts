import { expect, test } from "@playwright/test";
import { auditUX } from "./ux-audit";
import {
  E2E_PASSWORD,
  waitForEmail,
  openAccountEmail,
  completeBusinessBasics,
} from "./helpers";

test("a new owner creates their own isolated shop and reaches subscription billing", async ({
  page,
}, info) => {
  test.skip(
    process.env.PUBLIC_SIGNUP_ENABLED !== "true",
    "Self-service signup is gated until billing is configured.",
  );
  const stamp = `${info.project.name}-${Date.now()}`;
  const email = `new-owner-${stamp}@example.test`;
  await page.goto("/sign-in");
  await page
    .getByRole("link", { name: "Create an account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/sign-up$/);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Create a password", { exact: true })
    .fill(E2E_PASSWORD);
  await auditUX(page);
  const sentAt = Date.now();
  await page.getByRole("button", { name: "Create login", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  const confirmation = await waitForEmail(
    email,
    sentAt,
    /http:\/\/localhost:3000\/auth\/confirm\?[^\s"'<>]+/,
  );
  await openAccountEmail(page, confirmation);
  await expect(page).toHaveURL(/\/start$/);
  await completeBusinessBasics(page, "New Owner", `Independent Shop ${stamp}`);
  await page.goto("/app/settings/billing");
  await expect(page).toHaveURL(/\/automotive\?view=billing$/);
  await page.goto("/app/customers");
  await expect(page.getByText("Ford", { exact: true })).toHaveCount(0);
  await page.goto("/start");
  await expect(
    page.getByRole("heading", { name: "Subscription", exact: true }),
  ).toBeVisible();
});
