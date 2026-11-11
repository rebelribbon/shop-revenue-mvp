import { test, expect } from "@playwright/test";
import { signInWithPassword, revealField } from "./helpers";
import { auditUX } from "./ux-audit";
// The same form is exercised by the production browser suite and a dev-mode smoke.
test("owner can reuse common jobs, book a future visit, and log expenses without form errors", async ({
  page,
}, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      /hydration|uncontrolled|controlled input|validateDOMNesting|cannot be a descendant|unique.*key/i.test(
        m.text(),
      )
    )
      errors.push(m.text());
  });
  await signInWithPassword(page, "owner.b@shop-b.test");
  await page.goto("/app/settings/business");
  await page
    .getByLabel("What line of business are you in?")
    .selectOption("automotive");
  await page
    .getByLabel("Customer labor rate ($/hour)", { exact: true })
    .fill("125");
  await page.getByLabel("Your labor cost ($/hour)", { exact: true }).fill("40");
  await page.getByLabel("Default tax rate (%)", { exact: true }).fill("8.25");
  await page.getByLabel(/I chose this tax rate/).check();
  await page
    .getByRole("button", { name: "Save business profile", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("updated");
  await page.goto("/app/customers/new");
  const name = `Usability ${info.project.name} ${Date.now()}`;
  await page.getByLabel("First name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  await page.getByRole("link", { name: "Vehicles", exact: true }).click();
  await page.getByLabel("Make", { exact: true }).fill("Honda");
  await page.getByRole("button", { name: "Add vehicle", exact: true }).click();
  // The customer page has its own "+ New RO"; wait for the vehicle page.
  await expect(page).toHaveURL(/vehicles\/[0-9a-f-]+$/);
  await page.getByRole("link", { name: "+ New RO", exact: true }).click();
  await page
    .getByLabel("Job name", { exact: true })
    .fill(`Saved brakes ${name}`);
  await page.getByRole("button", { name: "Add part", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Pads");
  await page.getByLabel("Unit selling price", { exact: true }).fill("-1");
  await expect(
    page.getByText("Check negative or unusually large amounts before saving.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save job sheet", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Unit selling price", { exact: true }).fill("200");
  await revealField(page, "Unit cost");
  await page.getByLabel("Unit cost", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Add labor", exact: true }).click();
  await page
    .getByLabel("Description", { exact: true })
    .nth(1)
    .fill("Install pads");
  await expect(
    page.getByLabel("Hourly selling rate", { exact: true }),
  ).toHaveValue("125");
  await page.getByText("Save as a common job", { exact: true }).click();
  await page
    .getByRole("button", { name: "Save common job", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Common job saved");
  await auditUX(page);
  await page.screenshot({
    path: `test-results/owner-job-form-${info.project.name}.png`,
    fullPage: true,
  });
  await expect(page.getByRole("status")).not.toContainText(
    "Something went wrong",
  );
  await page.goto("/app/jobs?new=1");
  await page
    .getByLabel("Start from a common job", { exact: true })
    .selectOption({ label: `Saved brakes ${name}` });
  await page
    .getByRole("button", { name: "Use common job", exact: true })
    .click();
  await expect(page.getByLabel("Job name", { exact: true })).toHaveValue(
    `Saved brakes ${name}`,
  );
  await expect(
    page.getByLabel("Unit selling price", { exact: true }),
  ).toHaveValue("200");
  await page.goto("/app/schedule?new=1&week=2026-11-05");
  await page.getByLabel("Find customer", { exact: true }).fill(name);
  await page
    .getByLabel("Customer", { exact: true })
    .selectOption({ label: name });
  await page
    .getByLabel("Date and time", { exact: true })
    .fill("2026-11-05T09:00");
  await page
    .getByLabel("Reason", { exact: true })
    .fill(`Thursday brake visit ${name}`);
  await page.getByRole("button", { name: "Book visit", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Appointment booked");
  await expect(
    page.getByText(`Thursday brake visit ${name}`, { exact: false }),
  ).toBeVisible();
  await auditUX(page);
  await page.screenshot({
    path: `test-results/owner-week-${info.project.name}.png`,
    fullPage: true,
  });
  await page.goto("/app/schedule?new=1");
  await page.getByText("Add customer here", { exact: true }).click();
  await page
    .getByLabel("New customer first name", { exact: true })
    .fill(`New ${name}`);
  await page
    .getByRole("button", { name: "Add and select customer", exact: true })
    .click();
  await expect(
    page.getByLabel("Customer", { exact: true }).locator("option:checked"),
  ).toHaveText(`New ${name}`);
  await page.goto("/app/money?month=2026-10&new=1#expense-form");
  await page
    .getByLabel("What did you pay for?", { exact: true })
    .fill(`Shop rent ${name}`);
  await page.getByLabel("Amount paid ($)", { exact: true }).fill("125");
  await page.getByLabel("Date paid", { exact: true }).fill("2026-10-31");
  await page.getByLabel("Category", { exact: true }).selectOption("rent");
  await page.getByRole("button", { name: "Save expense", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Expense saved");
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: `Shop rent ${name}` })
      .filter({ hasText: "$125.00" }),
  ).toBeVisible();
  await auditUX(page);
  await page.screenshot({
    path: `test-results/owner-expense-${info.project.name}.png`,
    fullPage: true,
  });
  await page.goto("/app/money?month=2026-10");
  await expect(
    page.getByRole("heading", {
      name: "Estimated profit on this month’s invoices",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/collections above belong to the month money arrived/),
  ).toBeVisible();
  await auditUX(page);
  await page.screenshot({
    path: `test-results/owner-money-${info.project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("owner turns on online booking and a customer books a visit", async ({
  page,
  browser,
}, info) => {
  await signInWithPassword(page, "owner.a@shop-a.test");
  await page.goto("/app/settings/booking");
  const create = page.getByRole("button", {
    name: "Create my booking link",
    exact: true,
  });
  if (await create.count()) await create.click();
  const open = page.getByRole("link", { name: "Open your booking page" });
  await expect(open).toBeVisible();
  await auditUX(page);
  const href = await open.getAttribute("href");
  // A customer with no account opens the public page.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(new URL(href!, page.url()).href);
  await expect(
    visitor.getByRole("heading", { name: "Book a visit" }),
  ).toBeVisible();
  const who = `Booker ${info.project.name} ${Date.now()}`;
  await visitor.getByLabel("First name").fill("TEST");
  await visitor.getByLabel("Last name").fill(who);
  await visitor.getByLabel("Mobile phone").fill("(210) 831-2978");
  await visitor.getByLabel("What do you need?").fill("Brakes grinding");
  await visitor.getByRole("button", { name: "Request a visit" }).click();
  await expect(visitor.getByText("Thanks — we got it")).toBeVisible();
  await visitor.close();
  await page.goto("/app/tasks");
  await expect(
    page.getByText(`Online booking: call TEST ${who} about Brakes grinding`),
  ).toBeVisible();
});
