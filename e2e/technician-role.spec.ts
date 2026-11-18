import { expect, test } from "@playwright/test";
import { signInWithPassword } from "./helpers";
import { auditUX } from "./ux-audit";

// Owner B makes two jobs and puts Tech B on one; Tech B sees only that one
// and can't open owner pages or export money reports.
test("Technicians see only their jobs and no owner pages", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(150_000);
  const stamp = `${info.project.name} ${Date.now()}`;
  const mine = `Tech job ${stamp}`;
  const other = `Other job ${stamp}`;
  await signInWithPassword(page, "owner.b@shop-b.test");
  await page.goto("/app/customers/new");
  await page.getByLabel("First name").fill("Techrole");
  await page.getByLabel("Last name").fill(`TEST ${stamp}`);
  await page.getByLabel("Assigned service advisor").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  await expect(page).toHaveURL(/customers\/[0-9a-f-]+$/);
  await page.getByRole("link", { name: "Vehicles", exact: true }).click();
  await page.getByLabel("Make", { exact: true }).fill("Ford");
  await page.getByRole("button", { name: "Add vehicle", exact: true }).click();
  await expect(page).toHaveURL(/vehicles\/[0-9a-f-]+$/);
  const vehicleUrl = page.url();
  const jobUrls: string[] = [];
  for (const title of [mine, other]) {
    await page.goto(vehicleUrl);
    await page.getByRole("link", { name: "+ New RO", exact: true }).click();
    await page.getByLabel("Customer concerns / reason ¶»§q«^