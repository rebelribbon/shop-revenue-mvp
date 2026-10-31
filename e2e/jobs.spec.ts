import { auditUX } from "./ux-audit";
import { test, expect } from "@playwright/test";
import { drawEstimateSignature, signInWithPassword } from "./helpers";
test("tracks authorization, work completion, invoicing and payment in one job", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await signInWithPassword(page, "owner.a@shop-a.test");
  await page.goto("/app/customers/new");
  await page.getByLabel("First name").fill(`Job ${info.project.name}`);
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  await expect(page).toHaveURL(/customers\/[0-9a-f-]+$/);
  await page.getByRole("link", { name: "Vehicles", exact: true }).click();
  await page.getByLabel("Make", { exact: true }).fill("Honda");
  await page.getByRole("button", { name: "Add vehicle", exact: true }).click();
  await expect(page).toHaveURL(/vehicles\/[0-9a-f-]+$/);
  await page
    .getByRole("link", { name: "New repair / estimate", exact: true })
    .click();
  await page.getByLabel("Job name").fill(`Brakes ${info.project.name}`);
  await expect(
    page.getByLabel("Customer", { exact: true }).locator("option:checked"),
  ).toHaveText(`Job ${info.project.name}`);
  await expect(
    page.getByLabel("Vehicle", { exact: true }).locator("option:checked"),
  ).toHaveText("Honda");
  await page.getByRole("button", { name: "Add part", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Pads");
  await page.getByLabel("Unit cost", { exact: true }).fill("100");
  await page.getByLabel("Unit selling price", { exact: true }).fill("200");
  await expect(
    page.getByText("Quoted subtotal:", { exact: false }).first(),
  ).toContainText("$200.00");
  await page
    .getByRole("button", { name: "Save job sheet", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: `Brakes ${info.project.name}`,
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: `Brakes ${info.project.name}`,
      exact: true,
    }),
  ).toBeVisible();
  const jobUrl = page.url();
  const card = page
    .getByRole("heading", { name: `Brakes ${info.project.name}`, exact: true })
    .locator("..");
  await card
    .getByRole("button", { name: "Freeze and publish estimate", exact: true })
    .click();
  await expect(
    card.getByRole("link", { name: "Open customer estimate", exact: true }),
  ).toBeVisible();
  const href = await card
    .getByRole("link", { name: "Open customer estimate", exact: true })
    .getAttribute("href");
  await page.goto(href!);
  await expect(
    page.getByRole("heading", { name: "Estimate · Version 1", exact: true }),
  ).toBeVisible();
  await auditUX(page);
  await expect(page.locator("body")).not.toContainText("unit cost");
  await page
    .getByLabel("Your full name", { exact: true })
    .fill("Test Customer");
  await page.getByRole("checkbox", { name: /I have reviewed/ }).check();
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Sign decline", exact: true }),
  ).toBeDisabled();
  await page.getByRole("radio", { name: "Approve Pads", exact: true }).check();
  await expect(
    page.getByRole("button", { name: "Sign authorization", exact: true }),
  ).toBeDisabled();
  await drawEstimateSignature(page);
  await page
    .getByRole("button", { name: "Sign authorization", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Decision recorded", exact: true }),
  ).toBeVisible();
  await auditUX(page);
  await page.reload();
  await expect(page.getByText("Pads: Approved", { exact: true })).toBeVisible();
  await page.goto(jobUrl);
  const workflow = page.getByRole("region", {
    name: "Job workflow",
    exact: true,
  });
  await expect(
    workflow.getByRole("heading", { name: "Ready for work", exact: true }),
  ).toBeVisible();
  await expect(workflow).toContainText("Pads");
  await expect(workflow).toContainText("Authorized");
  await workflow
    .getByRole("button", { name: "Start authorized work", exact: true })
    .click();
  await expect(
    workflow.getByRole("heading", { name: "Work in progress", exact: true }),
  ).toBeVisible();
  await auditUX(page);
  await workflow
    .getByRole("button", { name: "Mark authorized work complete", exact: true })
    .click();
  await expect(
    workflow.getByRole("heading", { name: "Ready to invoice", exact: true }),
  ).toBeVisible();
  await workflow
    .getByRole("link", {
      name: "Create invoice for completed work",
      exact: true,
    })
    .click();
  await expect(
    page
      .getByLabel("Authorized estimate", { exact: true })
      .locator("option:checked"),
  ).toHaveText(
    `Brakes ${info.project.name} · Version 1 · Job ${info.project.name}`,
  );
  await expect(page.getByLabel("Payment due", { exact: true })).toHaveValue(
    "receipt",
  );
  await expect(page.getByLabel("Due date", { exact: true })).toHaveCount(0);
  await page.getByLabel("Payment due", { exact: true }).selectOption("date");
  await page.getByLabel("Due date", { exact: true }).fill("2026-12-01");
  if (info.project.name === "phone")
    await page.setViewportSize({ width: 320, height: 740 });
  await auditUX(page);
  await page.screenshot({
    path: `test-results/ux-invoice-date-${info.project.name}.png`,
    fullPage: true,
  });
  if (info.project.name === "phone")
    await page.setViewportSize({ width: 390, height: 844 });
  const issuer = page
    .getByRole("button", { name: "Issue invoice", exact: true })
    .locator("..");
  await issuer
    .getByRole("button", { name: "Issue invoice", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Open customer invoice", exact: true }),
  ).toBeVisible();
  const invoiceHref = await page
    .getByRole("link", { name: "Open customer invoice", exact: true })
    .getAttribute("href");
  await page
    .getByRole("link", { name: "Open invoice & record payment", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/invoices\?invoiceId=/);
  const invoiceUrl = page.url();
  const invoice = page
    .getByRole("heading", {
      name: new RegExp(`Invoice #.*Brakes ${info.project.name}`),
    })
    .locator("..");
  await invoice.getByLabel("Amount ($)", { exact: true }).fill("50");
  await invoice
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await expect(
    invoice.getByText("Partially paid", { exact: true }),
  ).toBeVisible();
  await invoice
    .getByRole("link", {
      name: "Job timeline, authorization & work remaining",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("region", { name: "Job workflow" }),
  ).toContainText("Partially paid");
  await expect(
    page.getByRole("region", { name: "Job workflow" }),
  ).toContainText("Complete");
  await expect(
    page.getByRole("region", { name: "Job workflow" }),
  ).toContainText("Work completed");
  await auditUX(page);
  await page.screenshot({
    path: `test-results/ux-job-workflow-${info.project.name}.png`,
    fullPage: true,
  });
  await page.locator("main").evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await auditUX(page);
  await page.screenshot({
    path: `test-results/ux-job-timeline-${info.project.name}.png`,
    fullPage: true,
  });
  await page.goto("/app/jobs");
  await expect(
    page.getByRole("link", {
      name: new RegExp(`^Open job: Brakes ${info.project.name}`),
    }),
  ).toContainText("Partially paid");
  await page.goto(invoiceUrl);
  await invoice.getByText("Correct this entry", { exact: true }).click();
  await invoice
    .getByLabel("Correction reason", { exact: true })
    .fill("UX confirmation check only");
  await invoice
    .getByRole("button", { name: "Reverse recorded entry", exact: true })
    .click();
  await expect(
    invoice.getByRole("button", { name: "Yes, continue", exact: true }),
  ).not.toHaveAttribute("data-ux-primary", "true");
  await page.goto(invoiceHref!);
  await auditUX(page);
  await expect(page.getByText("Balance due:", { exact: false })).toContainText(
    "$150.00",
  );
  await expect(page.locator("body")).not.toContainText("unit cost");
  await expect(page.locator("main")).toContainText("Dec 1, 2026");
});
