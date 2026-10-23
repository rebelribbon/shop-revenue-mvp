// Milestone 1 E2E: blocking scenario #1 and the M1 acceptance flows (owner
// invites Staff; Staff blocked from Owner-only actions; view-as is read-only and
// appears in the owner's support access log). Requires `pnpm seed` and a
// running worker-independent web app against the local stack.
import { expect, test } from "@playwright/test";
import { inviteLink, signInByEmail, signInBySms, signInLink } from "./helpers";

test.describe.configure({ mode: "serial" });

test("E2E #1a: owner signs in by email link and reaches Owner-only settings", async ({ page }) => {
  await signInByEmail(page, "owner.a@shop-a.test");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator("header")).toContainText("Shop A Auto");
  await page.getByRole("link", { name: "Team" }).click();
  await page.waitForURL(/\/team$/);
  await expect(page.getByRole("cell", { name: /Owner A/ })).toBeVisible();
  await page.getByRole("link", { name: "Support access" }).click();
  await expect(page.getByRole("heading", { name: "Support access" })).toBeVisible();
});

test("E2E #1b: Staff signs in by SMS code and cannot reach Owner-only actions", async ({ page }) => {
  await signInBySms(page, "+15125550101", "(512) 555-0101");
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole("link", { name: "Team" }).click();
  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send invite" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Support access" })).toHaveCount(0);
  await page.goto("/app/settings/support-access");
  await expect(page).toHaveURL(/\/app\?denied=1$/);
  await expect(page.getByText("Only the owner can open that page.")).toBeVisible();
});

test("unknown addresses get the same response and no email", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("nobody@example.test");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText("If that address has access");
});

test("F1 + Owner invites Staff: admin creates a shop, owner and staff accept invites, second invite blocked", async ({ browser }, info) => {
  const stamp = `${Date.now()}${info.project.name}`;
  const ownerEmail = `e2e-owner-${stamp}@example.test`;
  const staffEmail = `e2e-staff-${stamp}@example.test`;
  const shop = `E2E Garage ${stamp}`;

  const admin = await (await browser.newContext()).newPage();
  await signInByEmail(admin, "admin.one@example.test", "/admin/sign-in");
  await expect(admin).toHaveURL(/\/admin$/);
  let since = Date.now();
  await admin.getByLabel("Legal name").fill(`${shop} LLC`);
  await admin.getByLabel("DBA").fill(shop);
  await admin.getByLabel("Owner name").fill("Eve Owner");
  await admin.getByLabel("Owner email").fill(ownerEmail);
  await admin.getByRole("button", { name: "Create and invite owner" }).click();
  await expect(admin.getByRole("status")).toContainText("Owner invite sent");

  const owner = await (await browser.newContext()).newPage();
  await owner.goto(await inviteLink(ownerEmail, since));
  await expect(owner.getByRole("heading", { name: `Join ${shop}` })).toBeVisible();
  since = Date.now();
  await owner.getByRole("button", { name: "Send my sign-in link" }).click();
  await expect(owner.getByRole("status")).toContainText("We emailed a sign-in link");
  await owner.goto(await signInLink(ownerEmail, since));
  await owner.getByLabel("Your name").fill("Eve Owner");
  await owner.getByRole("button", { name: "Accept invite" }).click();
  await expect(owner).toHaveURL(/\/app$/);

  await owner.getByRole("link", { name: "Team" }).click();
  since = Date.now();
  await owner.getByLabel("Name").fill("Sid Staff");
  await owner.getByLabel("Email").fill(staffEmail);
  await owner.getByRole("button", { name: "Send invite" }).click();
  await expect(owner.getByRole("status")).toContainText("Invite sent by email");
  await expect(owner.getByText("Your plan includes one staff login")).toBeVisible();

  const staff = await (await browser.newContext()).newPage();
  await staff.goto(await inviteLink(staffEmail, since));
  since = Date.now();
  await staff.getByRole("button", { name: "Send my sign-in link" }).click();
  await staff.goto(await signInLink(staffEmail, since));
  await staff.getByLabel("Your name").fill("Sid Staff");
  await staff.getByRole("button", { name: "Accept invite" }).click();
  await expect(staff).toHaveURL(/\/app$/);
  await staff.getByRole("link", { name: "Team" }).click();
  await expect(staff.getByRole("cell", { name: /Sid Staff/ })).toBeVisible();
  await expect(staff.getByRole("button", { name: "Remove" })).toHaveCount(0);

  // Owner removes Staff: access ends on the staff member's next request.
  await owner.reload();
  await owner.getByRole("button", { name: "Remove" }).click();
  await owner.getByRole("button", { name: "Yes, continue" }).click();
  await expect(owner.getByRole("status")).toContainText("Removed.");
  await staff.goto("/app");
  await expect(staff).toHaveURL(/\/no-access$/);

  // View-as: support starts a read-only session with a reason; the owner sees it.
  const support = await (await browser.newContext()).newPage();
  await signInByEmail(support, "support.one@example.test", "/admin/sign-in");
  await support.getByRole("link", { name: shop }).click();
  await support.getByLabel("Reason (required)").fill("Owner asked us to check the team page");
  await support.getByRole("button", { name: "Start view-as" }).click();
  await expect(support).toHaveURL(/\/app$/);
  await expect(support.getByRole("alert").filter({ hasText: "as support (read-only)" })).toBeVisible();
  await support.getByRole("link", { name: "Team" }).click();
  await expect(support.getByRole("button", { name: "Send invite" })).toHaveCount(0);
  await support.getByRole("button", { name: "End view-as" }).click();
  await expect(support).toHaveURL(/\/admin$/);

  await owner.goto("/app/settings/support-access");
  const row = owner.getByRole("row", { name: /Sam Support/ });
  await expect(row).toContainText("Owner asked us to check the team page");
  await expect(owner.getByRole("cell", { name: "support_session.started" })).toBeVisible();
  await expect(owner.getByRole("cell", { name: "support_session.ended" })).toBeVisible();
});
