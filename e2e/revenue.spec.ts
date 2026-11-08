import { auditUX } from "./ux-audit";
import { test, expect } from "@playwright/test";
import { drawEstimateSignature, signInWithPassword } from "./helpers";
test("recovered revenue follows paid recommendation lines and keeps correction history", async ({
  page,
}, info) => {
  const name = `Revenue ${Date.now()} ${info.project.name}`,
    title = `Recovered brakes ${info.project.name}`;
  await signInWithPassword(page, "owner.a@shop-a.test");
  await page.goto("/app/customers/new");
  await page.getByLabel("First name").fill(name);
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  await expect(page).toHaveURL(/customers\/[0-9a-f-]+$/);
  await page.getByRole("link", { name: "Vehicles", exact: true }).click();
  await page.getByLabel("Make", { exact: true }).fill("Toyota");
  await page.getByRole("button", { name: "Add vehicle", exact: true }).click();
  await expect(page).toHaveURL(/vehicles\/[0-9a-f-]+$/);
  await page
    .getByRole("link", { name: "Service & notes", exact: true })
    .click();
  await page
    .getByText("Record declined / postponed work", { exact: true })
    .click();
  await page.getByLabel("Work recommended").fill("Front brakes postponed");
  await page.getByLabel("Quoted price before tax ($, optional)").fill("612");
  await page
    .getByRole("button", { name: "Save declined work", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Front brakes postponed", exact: true }),
  ).toBeVisible();
  await page.goto(`/app?category=declined&q=${encodeURIComponent(name)}`);
  const opportunity = page.locator("article.money-opportunity");
  await expect(opportunity).toHaveCount(1);
  await opportunity.getByText("Track follow-up", { exact: true }).click();
  await opportunity.getByLabel("Contact method").selectOption("in_person");
  await opportunity
    .getByLabel(
      "I reached the customer or confirmed this message was delivered.",
    )
    .check();
  await opportunity
    .getByLabel("Contact notes")
    .fill("Discussed the postponed brakes at the counter");
  await opportunity
    .getByRole("button", { name: "Save follow-up", exact: true })
    .click();
  await expect(opportunity).toContainText("contacted");
  await opportunity
    .getByLabel("What did the customer say?")
    .fill("Customer requested the re-quote and wants the brakes done");
  await opportunity
    .getByRole("button", { name: "Record customer response", exact: true })
    .click();
  await expect(opportunity).toContainText("responded");
  await opportunity
    .getByRole("button", { name: "Start job", exact: true })
    .click();
  await expect(page).toHaveURL(/jobs\?sourceRecoveryItemId=/);
  await page.getByLabel("Job name").fill(title);
  await page.getByRole("button", { name: "Add part", exact: true }).click();
  const parts = page.locator("fieldset:not(.hydration-fields):not(.chips)");
  await parts
    .nth(0)
    .getByLabel("Description", { exact: true })
    .fill("Re-quoted front brakes");
  await parts
    .nth(0)
    .getByLabel("Unit selling price", { exact: true })
    .fill("640");
  await parts
    .nth(0)
    .getByLabel("Declined-work link")
    .selectOption({ label: "Front brakes postponed" });
  await page.getByRole("button", { name: "Add part", exact: true }).click();
  await parts
    .nth(1)
    .getByLabel("Description", { exact: true })
    .fill("Wipers and filter");
  await parts
    .nth(1)
    .getByLabel("Unit selling price", { exact: true })
    .fill("202");
  await page
    .getByRole("button", { name: "Save job sheet", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  const job = page
    .getByRole("heading", { name: title, exact: true })
    .locator("xpath=ancestor::article[1]");
  await job
    .getByRole("button", {
      name: "Prepare estimate & choose recipient",
      exact: true,
    })
    .click();
  await expect(
    job.getByRole("link", { name: "Open customer estimate", exact: true }),
  ).toBeVisible();
  const estimateUrl = await job
    .getByRole("link", { name: "Open customer estimate", exact: true })
    .getAttribute("href");
  await page.goto(estimateUrl!);
  await page
    .getByLabel("Your full name", { exact: true })
    .fill("Test Customer");
  await page.getByRole("checkbox", { name: /I have reviewed/ }).check();
  for (const radio of await page
    .getByRole("radio", { name: /^Approve / })
    .all())
    await radio.check();
  await drawEstimateSignature(page);
  await page
    .getByRole("button", { name: "Sign authorization", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Decision recorded", exact: true }),
  ).toBeVisible();
  await page.goto("/app/invoices?new=1");
  await page
    .getByLabel("Authorized estimate", { exact: true })
    .selectOption({ label: `${title} · ${name}` });
  await page
    .getByRole("button", { name: "Create invoice", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Open invoice & record payment", exact: true })
    .click();
  const inv = page
    .getByRole("heading", { name: new RegExp(`Invoice #.*${title}`) })
    .locator("..");
  await expect(inv).toBeVisible();
  await inv.getByLabel("Amount ($)", { exact: true }).fill("842");
  await inv
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await expect(inv.getByText("Paid", { exact: true })).toBeVisible();
  await page.goto("/app/revenue");
  const record = page.locator("article.card").filter({ hasText: title });
  await expect(record).toContainText("Confirmed follow-up sale: $640.00");
  await record
    .getByRole("link", { name: "Explanation and history", exact: true })
    .click();
  await expect(
    page.getByText("Also on this visit, not counted: $202.00", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Immutable calculation history",
      exact: true,
    }),
  ).toBeVisible();
  await auditUX(page);
  await page.screenshot({
    path: `test-results/revenue-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByText("Not from this follow-up", { exact: true }).click();
  await page
    .getByLabel("Correction reason")
    .fill("Customer says this work was already planned");
  await page
    .getByRole("button", { name: "Remove from follow-up totals", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "No current credit: $0.00",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Direct adjustment: -$640.00", { exact: true }),
  ).toBeVisible();
});
