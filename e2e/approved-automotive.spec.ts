import { expect, test } from "@playwright/test";
import { signInWithPassword } from "./helpers";

// The Automotive experience must use the approved shell with authenticated
// shop data, not the browser-only demo / fake employee switcher.
test("approved Automotive interface loads real records without demo controls", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await signInWithPassword(page, "owner.b@shop-b.test");
  await page.goto("/automotive");
  await expect(page.locator("#app .app")).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("heading", { name: /Good afternoon|My workbench/ }),
  ).toBeVisible();
  await expect(page.getByText("Offline preview")).toHaveCount(0);
  await expect(
    page.locator("button[onclick*=\"openModal('role')\"]"),
  ).toHaveCount(0);
  await expect(page.getByText("INTERACTIVE DESIGN PROTOTYPE")).toHaveCount(0);
  const customerNav = page
    .locator(".nav-item:visible, .screen-mobile-nav button:visible")
    .filter({ hasText: "Customers" })
    .first();
  await customerNav.click();
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "+ Add customer" }),
  ).toBeVisible();
  expect(pageErrors, `Browser errors in ${info.project.name}`).toEqual([]);
});

test("Automotive creates a real customer and keeps it after reload", async ({
  page,
}, info) => {
  test.setTimeout(150_000);
  const key = `Unified ${info.project.name} ${Date.now()}`;
  await signInWithPassword(page, "owner.b@shop-b.test");
  await page.goto("/automotive");
  await expect(page.locator("#app .app")).toBeVisible();
  await page
    .locator(".nav-item:visible, .screen-mobile-nav button:visible")
    .filter({ hasText: "Customers" })
    .first()
    .click();
  await page.getByRole("button", { name: "+ Add customer" }).click();
  const modal = page.locator(".modal");
  await modal.locator('input[name="name"]').fill(key);
  // Both device projects write to the same shop: use distinct phone numbers\n  // so customer duplicate protection is not mistaken for a UI failure.\n  const suffix = String(Date.now() % 10000).padStart(4, "0");\n  await modal.locator('input[name="phone"]').fill(`+1210555${suffix}`);
  await modal
    .locator('input[name="email"]')
    .fill(`unified-${Date.now()}@example.test`);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/automotive/actions") &&
      response.request().method() === "POST",
  );
  await modal.getByRole("button", { name: "Create customer" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  await expect(page).toHaveURL(/\/automotive\?customer=[0-9a-f-]{36}/, {
    timeout: 30000,
  });
  await expect(page.getByRole("heading", { name: key })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: key })).toBeVisible();
});
