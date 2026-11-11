import { expect, test } from "@playwright/test";
import { signInWithPassword } from "./helpers";

test("recent customers reopen the selected record and RO shortcuts keep its contact details", async ({
  page,
}, info) => {
  await page.goto("/demo/crm?customer=jordan");
  await page.getByRole("link", { name: "← Customers", exact: true }).click();
  const recent = page.getByRole("region", {
    name: "Recently viewed customers",
    exact: true,
  });
  await recent
    .getByRole("link", { name: "Jordan Sample", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Jordan Sample", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "+ Appointment", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Customer", exact: true }),
  ).toHaveValue("Jordan Sample");
  await expect(
    page.getByRole("textbox", { name: "Vehicle", exact: true }),
  ).toHaveValue("2022 Toyota Camry");
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("link", { name: "Open job setup & pricing", exact: true })
    .click();
  const contacts = page.getByRole("group", {
    name: "Contact customer",
    exact: true,
  });
  await expect(
    contacts.getByRole("link", { name: "Call", exact: true }),
  ).toHaveAttribute("href", "tel:+12105550111");
  await expect(
    contacts.getByRole("link", { name: "Text", exact: true }),
  ).toHaveAttribute("href", "sms:+12105550111");
  await expect(
    contacts.getByRole("link", { name: "Email", exact: true }),
  ).toHaveAttribute("href", "mailto:jordan@example.test");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page
    .getByRole("button", { name: "Copy RO number", exact: true })
    .click();
  await expect(page.getByText("Copied.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "RO #10043",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/convenience-ro-${info.project.name}.png`,
    fullPage: true,
  });
});

test("the customer list doesn't show recent names from another account or the public demo", async ({
  page,
}, info) => {
  await signInWithPassword(page, "owner.b@shop-b.test");
  await page.evaluate(() => {
    const row = JSON.stringify([
      {
        id: "not-this-shop",
        name: "Other shop private customer",
        at: Date.now(),
      },
    ]);
    localStorage.setItem("shop-revenue:recent-customers", row);
    localStorage.setItem("shop-revenue:recent-customers:v1:public-demo", row);
    localStorage.setItem(
      "shop-revenue:recent-customers:v1:another-account",
      row,
    );
  });
  await page.goto("/app/customers/new");
  const name = `Recent ${info.project.name} ${Date.now()}`;
  await page.getByLabel("First name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);
  await page.goto("/app/customers");
  const recent = page.getByRole("region", {
    name: "Recently viewed customers",
    exact: true,
  });
  await expect(recent.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(recent).not.toContainText("Other shop private customer");
});
