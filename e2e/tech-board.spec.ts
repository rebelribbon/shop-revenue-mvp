import { expect, test } from "@playwright/test";
import { signInWithPassword } from "./helpers";
import { auditUX } from "./ux-audit";

// Tomorrow at 10:00 in the shop's time zone, for a datetime-local input.
const chicagoTomorrow = () => {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
  }).format(new Date(Date.now() + 86400000));
  return `${day}T10:00`;
};

test("Dispatch technician work and keep the owner board and appointments aligned", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const name = `Tech ${info.project.name} ${Date.now()}`;
  await signInWithPassword(page, "owner.b@shop-b.test");
  await page.goto("/app/customers/new");
  await page.getByLabel("First name").fill("Tech");
  await page.getByLabel("Last name").fill(`TEST ${info.project.name}`);
  await page.getByLabel("Assigned service advisor").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  await expect(page).toHaveURL(/customers\/[0-9a-f-]+$/);
  await page.getByRole("link", { name: "Vehicles", exact: true }).click();
  await page.getByLabel("Make", { exact: true }).fill("Ford");
  await page.getByRole("button", { name: "Add vehicle", exact: true }).click();
  await expect(page).toHaveURL(/vehicles\/[0-9a-f-]+$/);
  await page.getByRole("link", { name: "+ New RO", exact: true }).click();
  await page.getByLabel("Customer concerns / reason for visit").fill(name);
  await page.getByLabel¶»§q«^