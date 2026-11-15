import { test, expect } from "@playwright/test";
import { signInWithPassword, drawEstimateSignature, waitForEmail } from "./helpers";

test("walks a shop owner from customer creation through customer authorization and payment receipt", async ({ page, browser }, info) => {
  test.setTimeout(300_000);
  const stamp = Date.now();
  const name = `Audit ${stamp}`;
  const email = `audit-${stamp}@example.test`;
  const evidence = async (stage: string) => {
    console.log(`AUDIT STAGE: ${stage}; URL=${page.url()}`);
    await page.screenshot({ path: `test-results/audit-${stage}-${info.project.name}.png`, fullPage: true });
  };
  await test.step("1 customer", async () => {
    await signInWithPassword(page, "owner.b@shop-b.test");
    await page.goto("/app/customers/new");
    await page.getByLabel("Assigned service advisor").selectOption({ index: 1 });
    await page.getByLabel("First name", { exact: true }).fill(name);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Mobile number", { exact: true }).fill(`+1210555${String(stamp).slice(-4)}`);
    await page.getByRole("button", { name: "Add customer", exact: true }).click();
    await expect(page).toHaveURL(/customers\/[0-9a-f-]+$/);
    await evidence("customer");
  });
  await test.step("2 vehicle", async () => {
    await page.getByRole("link", { name: "Vehicles", exact: true }).click();
    await page.getByLabel("Make", { exact: true }).fill("Honda");
    await page.getByRole("button", { name: "Add vehicle", exact: true }).click();
    await expect(page).toHaveURL(/vehicles\/[0-9a-f-]+$/);
    await evidence("vehicle");
  });
  let jobId = "";
  await test.step("3 new RO", async () => {
    await page.getByRole("link", { name: "+ New RO", exact: true }).click();
    await page.getByLabel("Customer concerns / reason for visit").fill("Test brakes vibration and inspect rear tires");
    await page.getByLabel("Assigned service advisor").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Create RO", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/jobs\?job=/);
    jobId = new URL(page.url()).searchParams.get("job")!;
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
    await evidence("ro-created");
  });
  await test.step("4 technician handoff", async () => {
    const team = page.locator(".ro-team-assignment");
    if (!(await team.evaluate(e=>e.hasAttribute("open")))) await team.locator("summary").click();
    await team.getByLabel("Technician for this RO (all repairs)").selectOption({ label: "Tech B" });
    await team.getByRole("button", { name: "Assign technician" }).click();
    await page.reload();
    await evidence("technician-assigned");
  });
  await test.step("5 inspection and technician findings", async () => {
    const context = await browser.newContext({ baseURL: info.project.use.baseURL as string, viewport: page.viewportSize()! });
    try {
      const tech = await context.newPage();
      await signInWithPassword(tech, "tech.b@shop-b.test");
      await tech.goto(`/app/jobs?job=${jobId}`);
      await tech.getByLabel("I have the vehicle", { exact: true }).check();
      await tech.getByLabel("Rack / bay", { exact: true }).fill("Bay 2");
      await tech.getByRole("button", { name: "Start inspection", exact: true }).click();
      for (let section=0; section<9; section++) {
        const radios = await tech.getByRole("radio", { name: "Pass", exact: true }).all();
        for (const radio of radios) await radio.check();
        if (section === 0) {
          await tech.getByRole("radio", { name: "Fail", exact: true }).first().check();
          await tech.locator(".inspection-point-findings textarea").first().fill("Windshield cracked across the driver's field of view");
          await tech.locator(".inspection-point-findings input[type=text]").first().fill("Replace windshield");
        }
        if (section < 8)
          await tech.getByRole("button", { name: "Save and continue", exact: true }).click();
        else
          await tech.getByRole("button", { name: "Review inspection", exact: true }).click();
      }
      await tech.getByLabel("Technician diagnosis", { exact: true }).fill("Cracked windshield needs replacement; other inspection items passed");
      await tech.getByRole("button", { name: "Submit inspection to advisor", exact: true }).click();
      await expect(tech.getByText("Inspection submitted to the advisor.", { exact: true })).toBeVisible();
      await tech.screenshot({ path: `test-results/audit-inspection-${info.project.name}.png`, fullPage: true });
      console.log("AUDIT STAGE: inspection submitted");
    } finally { await context.close(); }
  });
  await test.step("6 advisor pricing", async () => {
    await page.goto(`/app/jobs?edit=${jobId}`);
    await expect(page.getByRole("heading", { name: "Price recommended repairs" })).toBeVisible();
    await evidence("pricing");
    const save = page.getByRole("button", { name: "Save & review proposal" });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page).toHaveURL(/customer-proposal-review/);
    await evidence("priced-saved");
  });
  await test.step("7 inline review and finalize", async () => {
    await expect(page.locator("#customer-proposal-review")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review before sending" })).toBeVisible();
    const preview = page.locator("#customer-proposal-review .docs-paper");
    await expect(preview).toBeVisible();
    const finalize = page.getByRole("button", { name: "Finalize estimate & prepare to send" });
    await expect(finalize).toBeEnabled();
    await finalize.click();
    await expect(page.getByRole("heading", { name: "Review and send the customer packet" })).toBeVisible();
    await evidence("finalized");
  });
  let publicUrl: string;
  await test.step("8 send and track", async () => {
    const area = page.locator("#customer-proposal-review");
    await expect(area.getByRole("heading", { name: "Send to customer" })).toBeVisible();
    const start = Date.now();
    await area.getByLabel("Email", { exact: true }).fill(email);
    await area.getByRole("button", { name: /Send email/i }).click();
    await expect(area).toContainText(/sent|submitted|emailed/i);
    publicUrl = await waitForEmail(email, start, /http:\/\/localhost:3000\/packet\?[^\s"'<>]+/);
    await evidence("sent");
  });
  await test.step("9 customer review + signature", async () => {
    const customerContext = await browser.newContext({ baseURL: info.project.use.baseURL as string });
    try {
      const customer = await customerContext.newPage();
      await customer.goto(publicUrl!);
      await expect(customer.locator("main")).toContainText(/inspection|estimate/i);
      const radios = await customer.getByRole("radio", { name: /^Approve/ }).all();
      for (const radio of radios) await radio.check();
      await customer.getByLabel("Your full name").fill("Audit Customer");
      await customer.getByRole("checkbox", { name: /I have reviewed/ }).check();
      await drawEstimateSignature(customer);
      await customer.getByRole("button", { name: "Sign authorization" }).click();
      await expect(customer.getByRole("heading", { name: "Decision recorded" })).toBeVisible();
      await customer.screenshot({ path: `test-results/audit-authorized-${info.project.name}.png`, fullPage: true });
    } finally { await customerContext.close(); }
  });
  await test.step("10 work completed and invoice", async () => {
    await page.goto(`/app/jobs?job=${jobId}`);
    const workflow = page.getByRole("region", { name: "Job workflow" });
    await workflow.getByRole("button", { name: "Start job" }).click();
    await workflow.getByRole("button", { name: "Mark job finished" }).click();
    await workflow.getByRole("link", { name: "Create invoice" }).click();
    await page.getByRole("button", { name: "Create invoice" }).last().click();
    await expect(page.getByRole("link", { name: "Open customer invoice" })).toBeVisible();
    await evidence("invoice");
    await page.getByRole("link", { name: "Open invoice & record payment" }).click();
  });
  await test.step("11 payment and receipt", async () => {
    await expect(page).toHaveURL(/\/app\/invoices\?invoiceId=/);
    const amount = page.getByLabel("Amount ($)", { exact: true });
    await expect(amount).toBeVisible();
    await page.getByRole("button", { name: "Record payment", exact: true }).click();
    await expect(page.locator("main")).toContainText(/paid|receipt/i);
    await evidence("paid-receipt");
    console.log("AUDIT RESULT: invoice paid; inspecting receipt access");
  });
});
