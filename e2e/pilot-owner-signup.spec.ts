import { expect, test } from "@playwright/test";
import { auditUX } from "./ux-audit";
import {
  E2E_PASSWORD,
  waitForEmail,
  openAccountEmail,
  completeBusinessBasics,
} from "./helpers";

test("an invited owner confirms their own email and creates a separate shop", async ({
  page,
}, info) => {
  // Exact local-only addresses configured by env:local. No real recipient is
  // enrolled or emailed by this disposable-stack test.
  const email = `pilot-owner-${info.project.name}@example.test`;
  const shopName = `Invited Shop ${info.project.name}`;
  await page.goto(`/owner-invite?email=${encodeURIComponent(email)}`);
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);
  await auditUX(page);
  const invitedAt = Date.now();
  await page
    .getByRole("button", { name: "Send invitation", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Invitation sent");
  const signup = await waitForEmail(
    email,
    invitedAt,
    /http:\/\/localhost:3000\/sign-up\?email=[^\s"'<>]+/,
  );
  await page.goto(signup);
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);
  await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await page
    .getByLabel("Create a password", { exact: true })
    .fill(E2E_PASSWORD);
  await auditUX(page);
  const confirmationAt = Date.now();
  await page.getByRole("button", { name: "Create login", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  const confirmation = await waitForEmail(
    email,
    confirmationAt,
    /http:\/\/localhost:3000\/auth\/confirm\?[^\s"'<>]+/,
  );
  await openAccountEmail(page, confirmation);
  await expect(page).toHaveURL(/\/start$/);
  await completeBusinessBasics(page, "New Owner", shopName);
  await page.goto("/app/settings/billing");
  await expect(page).toHaveURL(/\/automotive\?view=billing$/);
  await page.goto("/app/customers");
  await expect(page.getByText("Ford", { exact: true })).toHaveCount(0);
});

test("the owner invitation sender is unavailable for other addresses", async ({
  page,
}) => {
  await page.goto("/owner-invite?email=not-invited%40example.test");
  await expect(
    page.getByText("This invitation is not available.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send invitation", exact: true }),
  ).toHaveCount(0);
});
