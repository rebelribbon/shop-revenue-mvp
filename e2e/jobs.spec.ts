import { revealField } from "./helpers";
import { auditUX } from "./ux-audit";
import { test, expect } from "@playwright/test";
import { drawEstimateSignature, signInWithPassword } from "./helpers";
test("tracks authorization, work completion, invoicing and payment in one job", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await signInWithPassword(page, "owner.a@shop-a.test");
  // A unique number per run: the same mobile number is caught as a duplicate.
  const mobile = `+1512555${String(Date.now()).slice(-3)}${info.project.name === "phone" ? 1 : 2}`;
  await page.goto("/app/customers/new");
  await page.getByLabel("First name").fill(`Job ${info.project.name}`);
  await page.getByLabel("Mobile number", { exact: true }).fill(mobile);
  await page
    .getByLabel("Email", { exact: true })
    .fill(`job-${info.project.name}@example.test`);
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  await expect(page).toHaveURL(/customers\/[0-9a-f-]+$/);
  await page.getByRole("link", { name: "Vehicles", exact: true }).click();
  await page.getByLabel("Make", { exact: true }).fill("Honda");
  await page.getByRole("button", { name: "Add vehicle", exact: true }).click();
  await expect(page).toHaveURL(/vehicles\/[0-9a-f-]+$/);
  await page.getByRole("link", { name: "New job", exact: true }).click();
  await page.getByLabel("Job name").fill(`Brakes ${info.project.name}`);
  await expect(
    page.getByLabel("Customer", { exact: true }).locator("option:checked"),
  ).toHaveText(`Job ${info.project.name}`);
  await expect(
    page.getByLabel("Vehicle", { exact: true }).locator("option:checked"),
  ).toHaveText("Honda");
  await page.getByRole("button", { name: "Add part", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Pads");
  await revealField(page, "Unit cost");
  await page.getByLabel("Unit cost", { exact: true }).fill("100");
  await page.getByLabel("Unit selling price", { exact: true }).fill("200");
  await expect(
    page.getByText("Quoted subtotal:", { exact: false }).first(),
  ).toContainText("$200.00");
  await page.getByRole("button", { name: "Add labor", exact: true }).click();
  await page
    .getByLabel("Description", { exact: true })
    .nth(1)
    .fill("Optional diagnostic");
  await page.getByLabel("Quoted hours", { exact: true }).fill("1");
  await page.getByLabel("Hourly selling rate", { exact: true }).fill("100");
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
    .locator("xpath=ancestor::article[1]");
  await card
    .getByRole("button", { name: "Send estimate", exact: true })
    .click();
  await expect(
    card.getByRole("link", { name: "Text to customer", exact: true }),
  ).toHaveAttribute(
    "href",
    new RegExp(`^sms:\\${mobile}[?&]body=.*%2Festimate%2F`),
  );
  await expect(
    card.getByRole("link", { name: "Email to customer", exact: true }),
  ).toHaveAttribute(
    "href",
    new RegExp(
      `^mailto:job-${info.project.name}@example\\.test\\?subject=.*&body=.*%2Festimate%2F`,
    ),
  );
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
  await page
    .getByRole("radio", { name: "Decline Optional diagnostic", exact: true })
    .check();
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
    workflow.getByRole("heading", { name: /approved \$/ }),
  ).toBeVisible();
  await expect(workflow).toContainText("Pads");
  await expect(workflow).toContainText("Approved work");
  await workflow
    .getByRole("button", { name: "Start job", exact: true })
    .click();
  await expect(
    workflow.getByRole("heading", { name: /^Work in progress:/ }),
  ).toBeVisible();
  await auditUX(page);
  await workflow
    .getByRole("button", { name: "Mark job finished", exact: true })
    .click();
  await expect(
    workflow.getByRole("heading", { name: /^Work finished:/ }),
  ).toBeVisible();
  await workflow
    .getByRole("link", {
      name: "Create invoice",
      exact: true,
    })
    .click();
  await expect(
    page
      .getByLabel("Authorized estimate", { exact: true })
      .locator("option:checked"),
  ).toHaveText(`Brakes ${info.project.name} · Job ${info.project.name}`);
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
    .getByRole("button", { name: "Create invoice", exact: true })
    .locator("..");
  await issuer
    .getByRole("button", { name: "Create invoice", exact: true })
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
  await expect(invoice.getByLabel("Amount ($)", { exact: true })).toHaveValue(
    "200.00",
  );
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
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.locator("ol.workflow-timeline")).toContainText(
    "Work completed",
  );
  // Inspection: mark an item, save, and send it to the estimate.
  await page.getByRole("link", { name: /^Inspection/ }).click();
  const brakes = page.getByRole("group", { name: "Front brakes" });
  await brakes.getByLabel("Needs work").check();
  await brakes.getByLabel("What did you find?").fill("pads at 2 mm");
  await page
    .getByRole("button", { name: "Save inspection", exact: true })
    .click();
  await expect(page.getByText("1 need work")).toBeVisible();
  await auditUX(page);
  await page.screenshot({
    path: `test-results/ux-inspection-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "Work", exact: true }).click();
  // Profit sits at the top of the job; the clock is one tap.
  await expect(page.locator(".profit-chip")).toBeVisible();
  await page
    .getByRole("button", { name: "▶ Start clock", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /^■ Stop clock/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^■ Stop clock/ }).click();
  await expect(
    page.getByRole("button", { name: "▶ Start clock", exact: true }),
  ).toBeVisible();
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
  ).toContainText("owes $150.00");
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

  // Checkout: take part of the balance in cash at the counter.
  await page.goto(
    `/app/checkout?invoiceId=${new URL(invoiceUrl).searchParams.get("invoiceId")}`,
  );
  await expect(page.locator(".checkout-amount")).toHaveText("$150.00");
  await page.getByRole("radio", { name: /^Cash/ }).check();
  await page.getByLabel(/^Amount to take/).fill("20");
  await page.getByRole("button", { name: "$20.00", exact: true }).click();
  await expect(page.getByText("Change due: $0.00")).toBeVisible();
  await auditUX(page);
  await page.screenshot({
    path: `test-results/ux-checkout-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Take $20.00", exact: true }).click();
  await expect(page.getByText("Payment taken")).toBeVisible();
  await expect(page.getByText("$130.00 is still due")).toBeVisible();
  await auditUX(page);
});
