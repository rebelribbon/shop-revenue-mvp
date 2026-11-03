import { expect, test } from "@playwright/test";
import { signInWithPassword } from "./helpers";
import { auditUX } from "./ux-audit";

async function auditPage(page: import("@playwright/test").Page) {
  await auditUX(page, true);
  await page.locator("main").evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await auditUX(page, true);
  await page.locator("main").evaluate((e) => e.scrollTo(0, 0));
}

test("UX standards across public, shop, detail and admin pages", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  for (const path of [
    "/sign-in",
    "/forgot-password",
    "/admin/sign-in",
    "/invite/not-a-valid-token",
    "/not-a-real-page",
  ]) {
    await page.goto(path);
    await auditPage(page);
  }
  await signInWithPassword(page, "owner.a@shop-a.test");
  for (const path of [
    "/app",
    "/app/work",
    "/app/new",
    "/app/customers",
    "/app/customers/new",
    "/app/opportunities",
    "/app/tasks",
    "/app/tasks?add=1",
    "/app/settings/follow-ups",
    "/app/money/register",
    "/app/jobs",
    "/app/jobs?new=1",
    "/app/jobs?view=board",
    "/app/create",
    "/app/checkout",
    "/app/estimates",
    "/app/invoices",
    "/app/invoices?new=1",
    "/app/schedule",
    "/app/schedule?new=1",
    "/app/revenue",
    "/app/settings",
    "/app/settings/business",
    "/app/settings/team",
    "/app/settings/support-access",
    "/app/settings/payments",
    "/app/settings/export",
  ]) {
    await page.goto(path);
    const destination =
      path === "/app/work"
        ? "/app/jobs"
        : path === "/app/new"
          ? "/app/jobs?new=1"
          : path;
    await expect(page).toHaveURL(new URL(destination, page.url()).href);
    await auditPage(page);
    if (
      [
        "/app/customers",
        "/app/jobs",
        "/app/estimates",
        "/app/invoices",
        "/app/schedule",
      ].includes(path)
    )
      await page.screenshot({
        path: `test-results/ux-${path.split("/").pop()}-${info.project.name}.png`,
        fullPage: true,
      });
  }
  await page.goto("/app/opportunities");
  const followup = page
    .locator("summary")
    .filter({ hasText: "Track follow-up" })
    .first();
  if (await followup.count()) {
    await followup.click();
    await auditPage(page);
  }
  await page.goto("/app/customers/new");
  const name = `UX ${info.project.name} ${Date.now()}`;
  await page.getByLabel("First name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  await expect(page).toHaveURL(/\/customers\/[a-f0-9-]+$/);
  await auditPage(page);
  await page.screenshot({
    path: `test-results/ux-customer-${info.project.name}.png`,
    fullPage: true,
  });
  await expect(page.getByLabel("First name", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Details", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Details", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await auditPage(page);
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "History", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await auditPage(page);
  await page.getByRole("link", { name: "Vehicles", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Vehicles", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await auditPage(page);
  await page.getByLabel("Make", { exact: true }).fill("UX vehicle");
  await page.getByRole("button", { name: "Add vehicle", exact: true }).click();
  await expect(page).toHaveURL(/\/vehicles\/[a-f0-9-]+$/);
  await auditPage(page);
  await page.getByRole("link", { name: "Edit vehicle", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Edit vehicle", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await auditPage(page);
  await page
    .getByRole("link", { name: "Service & notes", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Service & notes", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await auditPage(page);
  await page.goto("/app");
  await auditPage(page);
  await page.screenshot({
    path: `test-results/ux-home-${info.project.name}.png`,
    fullPage: true,
  });
  if (info.project.name === "phone") {
    await page.setViewportSize({ width: 320, height: 740 });
    await auditPage(page);
    await page.screenshot({
      path: "test-results/ux-home-narrow.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Quick find", exact: true }).click();
    const finder = page.getByRole("dialog", {
      name: "Quick find",
      exact: true,
    });
    await expect(finder.locator("[data-ux-primary]")).toHaveText("Search");
    await auditUX(page, true);
    await page.screenshot({
      path: "test-results/ux-quick-find-narrow.png",
      fullPage: true,
    });
    await finder.getByRole("button", { name: "Close", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
  }
  if (info.project.name === "desktop") {
    await page.emulateMedia({ colorScheme: "dark" });
    await auditPage(page);
    await page.screenshot({
      path: "test-results/ux-home-dark.png",
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: "light" });
  }
  await page.request.post("/auth/sign-out");
  await signInWithPassword(page, "admin.one@example.test", "/admin/sign-in");
  for (const path of [
    "/admin",
    "/admin/release",
    "/admin/policies",
    "/admin/webhooks",
    "/admin/help",
  ]) {
    await page.goto(path);
    await auditPage(page);
  }
  await page.goto("/admin");
  const tenant = page.locator("tbody a").first();
  await tenant.click();
  await expect(page).toHaveURL(/\/admin\/tenants\/[a-f0-9-]+$/);
  await auditPage(page);
  if (info.project.name === "phone") {
    await page.setViewportSize({ width: 320, height: 740 });
    await auditPage(page);
    await page.screenshot({
      path: "test-results/ux-admin-narrow.png",
      fullPage: true,
    });
  }
});

test("core pages stay within three homepage clicks and primary actions follow the active form", async ({
  page,
}, info) => {
  await signInWithPassword(page, "owner.a@shop-a.test");
  await page.getByRole("button", { name: "Quick find", exact: true }).click();
  const finder = page.getByRole("dialog", { name: "Quick find", exact: true });
  await expect(finder.getByRole("textbox")).toBeFocused();
  await expect(finder.locator("[data-ux-primary]")).toHaveText("Search");
  await auditUX(page);
  await finder.getByRole("button", { name: "Close", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    finder.getByRole("button", { name: "Search", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    finder.getByRole("button", { name: "Close", exact: true }),
  ).toBeFocused();
  await finder.getByRole("textbox").fill(`Job ${info.project.name}`);
  await finder.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/customers\?q=/);
  await expect(
    page.getByRole("link", { name: `Job ${info.project.name}`, exact: true }),
  ).toBeVisible();
  await page.goto("/app");
  await page.getByRole("link", { name: "Jobs", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Jobs", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Job name", { exact: true })).toHaveCount(0);
  await page.getByLabel("Find a job", { exact: true }).focus();
  await expect(page.locator("[data-ux-primary]")).toHaveText("New job");
  await page.getByRole("link", { name: "New job", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/jobs\?new=1$/);
  await page.getByLabel("Job name", { exact: true }).fill("Keep this draft");
  await page.keyboard.press("Control+k");
  await expect(finder).toBeVisible();
  await expect(finder.locator("[data-ux-primary]")).toHaveText("Search");
  await page.keyboard.press("Escape");
  await expect(finder).not.toBeVisible();
  await expect(page.getByLabel("Job name", { exact: true })).toHaveValue(
    "Keep this draft",
  );
  await page.getByLabel("Job name", { exact: true }).focus();
  await expect(page.locator("[data-ux-primary]")).toHaveText("Save job sheet");
  await page.locator("main").evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await expect(page.locator("[data-ux-primary]")).toBeInViewport();
  await auditPage(page);
  await page.goto("/app");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("link", { name: "Business profile", exact: false })
    .click();
  await page
    .getByRole("link", { name: "Set up online payments", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/settings\/payments$/);
});
