import { expect, test } from "@playwright/test";
import { signInWithPassword } from "./helpers";

// TEST data only. The advisor checks a vehicle in without pricing anything:
// customer, vehicle, miles, concerns. The RO opens with those on it.
test("advisor checks a vehicle in from one short screen", async ({
  page,
}, info) => {
  const name = `Checkin ${info.project.name} ${Date.now()}`;
  await signInWithPassword(page, "owner.b@shop-b.test");
  await page.goto("/app/jobs?new=1");
  await expect(
    page.getByRole("heading", { name: "New RO", exact: true }),
  ).toBeVisible();
  // No pricing on this screen.
  await expect(page.getByLabel("Job name", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add part", exact: true }),
  ).toHaveCount(0);
  const submit = page.getByRole("button", { name: "Create RO", exact: true });
  await expect(submit).toBeDisabled();

  await page.getByText("Add customer here").click();
  await page.getByLabel("New customer first name").fill(name);
  await page.getByLabel("New customer last name").fill("TEST");
  await page
    .getByRole("button", { name: "Add and select customer", exact: true })
    .click();
  await expect(page.getByText("Customer added and selected.")).toBeVisible();

  // No vehicle on file: the add-vehicle fields are already open.
  await page.getByLabel("Make", { exact: true }).fill("Ford");
  await page.getByLabel("Model", { exact: true }).fill("F-150");
  await page.getByRole("button", { name: "Add vehicle", exact: true }).click();
  await expect(page.getByLabel("Vehicle", { exact: true })).toContainText(
    "Ford F-150",
  );
  await page.getByLabel("Mileage at check-in", { exact: true }).fill("84250");
  await page
    .getByLabel("Customer concerns / reason for visit", { exact: true })
    .fill("Grinding noise when braking. Started last week.");
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page).toHaveURL(/\/app\/jobs\?job=[0-9a-f-]+&saved=checkin$/);
  await expect(page.getByText("Vehicle checked in.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Repair order", exact: true }),
  ).toBeVisible();
  // Pricing waits for the technician's inspection.
  await expect(
    page.getByRole("heading", { name: "Assign a technician", exact: true }),
  ).toBeVisible();
  const checkIn = page.getByLabel("Check-in", { exact: true });
  await expect(checkIn).toContainText("84,250");
  await expect(checkIn).toContainText("Grinding noise when braking.");
});
