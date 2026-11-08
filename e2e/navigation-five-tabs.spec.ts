import { expect, test } from "@playwright/test";
import { signInWithPassword } from "./helpers";
import { auditUX } from "./ux-audit";

test("mobile app navigation uses five purpose-built sections", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo/crm");
  const nav = page.getByRole("navigation", {
    name: "Mobile sample navigation",
  });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link")).toHaveCount(5);
  for (const name of ["Appts", "Tasks", "Customers", "Jobs", "Reports"]) {
    await expect(nav.getByRole("link", { name })).toBeVisible();
  }
  await nav.getByRole("link", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(
    page.getByText("Operational and financial performance", { exact: false }),
  ).toBeVisible();
  await nav.getByRole("link", { name: "Appts" }).click();
  await expect(
    page.getByRole("heading", { name: "Appointments" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Book appointment" }).click();
  await expect(
    page.getByRole("heading", { name: "New appointment" }),
  ).toBeVisible();
});

test("appointment can be started from a customer's profile and RO history remains visible", async ({
  page,
}) => {
  await page.goto("/demo/crm?customer=jordan");
  await page.getByRole("link", { name: "+ Appointment" }).click();
  await expect(
    page.getByRole("heading", { name: "New appointment" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Customer", exact: true }),
  ).toHaveValue("Jordan Sample");
  await page.getByRole("button", { name: "Save appointment" }).click();
  await expect(page.getByText("Appointment saved in this demo")).toBeVisible();
  await page.goto("/demo/crm?customer=alex&tab=Jobs");
  await expect(page.getByText("RO #10042", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "Open job setup & pricing" }).click();
  await expect(page.getByRole("heading", { name: "RO Setup" })).toBeVisible();
});

test("customer RO history and appointment context work in the authenticated workspace", async ({
  page,
}, info) => {
  await signInWithPassword(page, "owner.a@shop-a.test");
  await page.goto("/app/customers/new");
  const name = `Navigation ${info.project.name} ${Date.now()}`;
  await page.getByLabel("First name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);
  const customerUrl = page.url();
  const sections = page.getByRole("navigation", { name: "Customer sections" });
  await sections.getByRole("link", { name: /^ROs/ }).click();
  await expect(
    page.getByRole("heading", { name: "Repair order history", exact: true }),
  ).toBeVisible();
  await expect(sections.getByRole("link")).toHaveCount(5);
  await expect(
    page.getByRole("link", { name: "+ Attachment", exact: true }),
  ).toHaveCount(0);
  await auditUX(page);
  await page.getByRole("link", { name: "+ Appointment", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "New appointment", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Customer", { exact: true }).locator("option:checked"),
  ).toHaveText(name);
  await page.goto(customerUrl);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page
    .locator("nav:visible")
    .getByRole("link", { name: "Reports", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Reports", exact: true }),
  ).toBeVisible();
  const reports = page.getByRole("group", { name: "Report", exact: true });
  await reports
    .getByRole("link", { name: "New customers", exact: true })
    .click();
  await expect(
    page.getByRole("table").getByRole("cell", { name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Download New customers (CSV)",
      exact: true,
    }),
  ).toHaveAttribute("href", /report=customer-growth/);
  await auditUX(page);
});
