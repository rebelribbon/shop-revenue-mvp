import { expect, test } from "@playwright/test";
import { signInWithPassword } from "./helpers";

test("customer and vehicle edits persist, and archive preserves history", async ({ page }, info) => {
  const name = `Lifecycle ${Date.now()} ${info.project.name}`;
  await signInWithPassword(page, "owner.a@shop-a.test");
  await page.goto("/app/customers#new-customer");
  await page.getByLabel("First name").fill(name);
  await page.getByLabel("Last name").fill("Original");
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);
  const customerUrl = page.url();
  await page.getByLabel("Last name").fill("Updated");
  await page.getByLabel("Notes", { exact: true }).first().fill("Customer note retained after reload");
  await page.getByRole("button", { name: "Save customer" }).click();
  await expect(page.getByRole("status")).toContainText("Customer updated");
  await page.reload();
  await expect(page.getByLabel("Last name")).toHaveValue("Updated");
  await expect(page.getByLabel("Notes", { exact: true }).first()).toHaveValue("Customer note retained after reload");

  await page.getByLabel("Year", { exact: true }).fill("2024");
  await page.getByLabel("Make", { exact: true }).fill("BMW");
  await page.getByLabel("Model", { exact: true }).fill("X5");
  await page.getByLabel("Mileage", { exact: true }).fill("12000");
  await page.getByRole("button", { name: "Add vehicle", exact: true }).click();
  await expect(page).toHaveURL(/\/vehicles\/[0-9a-f-]+$/);
  await page.getByLabel("Mileage", { exact: true }).fill("12500");
  await page.getByLabel("Notes", { exact: true }).fill("Vehicle note retained after reload");
  await page.getByRole("button", { name: "Save vehicle" }).click();
  await expect(page.getByRole("status")).toContainText("Vehicle updated");
  await page.reload();
  await expect(page.getByLabel("Mileage", { exact: true })).toHaveValue("12500");
  await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("Vehicle note retained after reload");
  await page.getByRole("button", { name: "Archive vehicle" }).click();
  await page.getByRole("button", { name: "Yes, continue" }).click();
  await expect(page).toHaveURL(customerUrl);
  await expect(page.getByText("No vehicles yet.")).toBeVisible();
  await expect(page.getByText("Vehicle archived: 2024 BMW X5", { exact: true })).toBeVisible();
  await expect(page.getByText("Vehicle updated: 2024 BMW X5", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Archive customer" }).click();
  await page.getByRole("button", { name: "Yes, continue" }).click();
  await expect(page).toHaveURL(/\/app\/customers$/);
  await page.goto(`/app/customers?q=${encodeURIComponent(name)}`);
  await expect(page.getByRole("link", { name: `${name} Updated`, exact: true })).toHaveCount(0);
});

test("staff can view business profile but cannot edit it", async ({ page }) => {
  await signInWithPassword(page, "staff.a@shop-a.test");
  await page.goto("/app/settings/business");
  await expect(page.getByRole("heading", { name: "Business profile" })).toBeVisible();
  await expect(page.getByText("Only the owner can edit the business profile.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save business profile" })).toHaveCount(0);
});
