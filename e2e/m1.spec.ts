// M1 acceptance flows retained under the M2 email/password auth decision.
import { auditUX } from "./ux-audit";
import { expect, test } from "@playwright/test";
import { E2E_PASSWORD, inviteLink, setInvitePassword, signInWithPassword } from "./helpers";

test.describe.configure({ mode: "serial" });

test("E2E #1a: owner signs in with password and reaches Owner-only settings", async ({ page }) => {
  await signInWithPassword(page, "owner.a@shop-a.test");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator("header")).toContainText("Shop A Auto");
  await page.goto("/app/settings/team");
  await expect(page.getByRole("cell", { name: /Owner A/ })).toBeVisible();
  await page.goto("/app/settings/support-access");
  await expect(page.getByRole("heading", { name: "Support access" })).toBeVisible();
});

test("E2E #1b: Staff signs in with password and cannot reach Owner-only actions", async ({ page }) => {
  await signInWithPassword(page, "staff.a@shop-a.test");
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/app/settings/team");
  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send invite" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await page.goto("/app/settings/support-access");
  await expect(page).toHaveURL(/\/app\?denied=1$/);
  await expect(page.getByText("Only the owner can open that page.")).toBeVisible();
});

test("invalid password gets a generic credential error", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("nobody@example.test");
  await page.getByLabel("Password").fill("DefinitelyWrong123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("status")).toContainText("Email or password is incorrect");
});

test("F1 + Owner invites Staff: owner and staff choose passwords, second staff seat blocked, view-as remains read-only", async ({ browser }, info) => {
  const stamp = `${Date.now()}${info.project.name}`;
  const ownerEmail = `e2e-owner-${stamp}@example.test`;
  const staffEmail = `e2e-staff-${stamp}@example.test`;
  const shop = `E2E Garage ${stamp}`;

  const admin = await (await browser.newContext()).newPage();
  await signInWithPassword(admin, "admin.one@example.test", "/admin/sign-in");
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
  await auditUX(owner);
  since = Date.now();
  await owner.getByRole("button", { name: "Send account setup email" }).click();
  await expect(owner.getByRole("status")).toContainText("emailed account setup");
  await setInvitePassword(owner, ownerEmail, since, E2E_PASSWORD);
  await expect(owner).toHaveURL(/\/invite\//);
  await auditUX(owner);
  await owner.getByLabel("Your name").fill("Eve Owner");
  await owner.getByRole("button", { name: "Accept invite" }).click();
  await expect(owner).toHaveURL(/\/app$/);

  await owner.goto("/app/settings/team");
  since = Date.now();
  await owner.getByLabel("Name").fill("Sid Staff");
  await owner.getByLabel("Email").fill(staffEmail);
  await owner.getByRole("button", { name: "Send invite" }).click();
  // The invite form unmounts when the occupied seat arrives in the refreshed RSC.
  // Assert the durable invitation, then prove delivered email and access below.
  await expect(owner.getByRole("row").filter({ hasText: staffEmail })).toContainText("Invite sent");
  await expect(owner.getByText("Your plan includes one staff login")).toBeVisible();

  const staff = await (await browser.newContext()).newPage();
  await staff.goto(await inviteLink(staffEmail, since));
  since = Date.now();
  await staff.getByRole("button", { name: "Send account setup email" }).click();
  await expect(staff.getByRole("status")).toContainText("emailed account setup");
  await setInvitePassword(staff, staffEmail, since, E2E_PASSWORD);
  await expect(staff).toHaveURL(/\/invite\//);
  await staff.getByLabel("Your name").fill("Sid Staff");
  await staff.getByRole("button", { name: "Accept invite" }).click();
  await expect(staff).toHaveURL(/\/app$/);
  await staff.goto("/app/settings/team");
  await expect(staff.getByRole("cell", { name: /Sid Staff/ })).toBeVisible();
  await expect(staff.getByRole("button", { name: "Remove" })).toHaveCount(0);

  await owner.reload();
  await owner.getByRole("button", { name: "Remove" }).click();
  await owner.getByRole("button", { name: "Yes, continue" }).click();
  await expect(owner.getByRole("status")).toContainText("Removed.");
  await staff.goto("/app");
  await expect(staff).toHaveURL(/\/no-access$/);
  await auditUX(staff);

  const support = await (await browser.newContext()).newPage();
  await signInWithPassword(support, "support.one@example.test", "/admin/sign-in");
  await support.getByRole("link", { name: shop }).click();
  await support.getByLabel("Reason (required)").fill("Owner asked us to check the team page");
  await support.getByRole("button", { name: "Start view-as" }).click();
  await expect(support).toHaveURL(/\/app$/);
  await expect(support.getByRole("alert").filter({ hasText: "as support (read-only)" })).toBeVisible();
  await support.goto("/app/settings/team");
  await expect(support.getByRole("button", { name: "Send invite" })).toHaveCount(0);
  await support.getByRole("button", { name: "End view-as" }).click();
  await expect(support).toHaveURL(/\/admin$/);

  await owner.goto("/app/settings/support-access");
  const row = owner.getByRole("row", { name: /Sam Support/ });
  await expect(row).toContainText("Owner asked us to check the team page");
  await expect(owner.getByRole("cell", { name: "support_session.started" })).toBeVisible();
  await expect(owner.getByRole("cell", { name: "support_session.ended" })).toBeVisible();
});
