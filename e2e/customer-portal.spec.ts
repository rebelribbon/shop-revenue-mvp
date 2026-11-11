import { expect, test } from "@playwright/test";
import { signInWithPassword } from "./helpers";
import { auditUX } from "./ux-audit";

test("Customer link opens one page with everything for that customer", async ({
  page,
  browser,
}, info) => {
  const stamp = `${info.project.name}${Date.now()}`;
  await signInWithPassword(page, "owner.b@shop-b.test");
  await page.goto("/app/customers/new");
  await page.getByLabel("First name").fill("Portal");
  await page.getByLabel("Last name").fill(`TEST ${stamp}`);
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);

  await page.locator(".record-customer-tools > summary").click();
  await page.getByRole("button", { name: "Create customer link" }).click();
  const copy = page.getByRole("button", { name: "Copy customer link" });
  await expect(copy).toBeVisible();
  await auditUX(page, true);
  const path = await copy.getAttribute("data-link-path");
  expect(path).toMatch(/^\/c\/.+/);

  // The customer is not signed in.
  const guest = await browser.newContext({
    viewport: page.viewportSize() ?? undefined,
  });
  const g = await guest.newPage();
  await g.goto(path!);
  await expect(
    g.getByRole("heading", { name: "Hi Portal", level: 1 }),
  ).toBeVisible();
  await expect(g.getByText(/all set/)).toBeVisible();
  await auditUX(g, true);
  const missing = await g.goto("/c/not-a-real-link");
  expect(missing?.status()).toBe(404);
  await guest.close();
});
