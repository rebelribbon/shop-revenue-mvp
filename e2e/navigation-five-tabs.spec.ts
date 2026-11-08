import { expect, test } from "@playwright/test";

test("mobile app navigation uses five purpose-built sections", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo/crm");
  const nav = page.getByRole("navigation", { name: "Mobile sample navigation" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link")).toHaveCount(5);
  for (const name of ["Appts", "Tasks", "Customers", "Jobs", "Reports"]) {
    await expect(nav.getByRole("link", { name })).toBeVisible();
  }
  await nav.getByRole("link", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(page.getByText("Operational and financial performance", { exact: false })).toBeVisible();
  await nav.getByRole("link", { name: "Appts" }).click();
  await expect(page.getByRole("heading", { name: "Appointments" })).toBeVisible();
  await page.getByRole("link", { name: "Book appointment" }).click();
  await expect(page.getByRole("heading", { name: "New appointment" })).toBeVisible();
});

test("appointment can be started from a customer's profile and RO history remains visible", async ({ page }) => {
  await page.goto("/demo/crm?customer=alex");
  await page.getByRole("link", { name: "+ Appointment" }).click();
  await expect(page.getByRole("heading", { name: "New appointment" })).toBeVisible();
  await page.getByRole("button", { name: "Save appointment" }).click();
  await expect(page.getByText("Appointment saved in this demo")).toBeVisible();
  await page.goto("/demo/crm?customer=alex&tab=Jobs");
  await expect(page.getByText("RO #10042", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "Open job setup & pricing" }).click();
  await expect(page.getByRole("heading", { name: "Job Setup" })).toBeVisible();
});
