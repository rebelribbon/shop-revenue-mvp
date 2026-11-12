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
    await page.getByLabel("Customer concerns / reason for visit").fill(title);
    await page.getByLabel("Assigned service advisor").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Create RO", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Repair order", exact: true }),
    ).toBeVisible();
    jobUrls.push(page.url());
  }
  await page.goto(jobUrls[0]);
  await page.getByLabel("Tech on this job").selectOption({ label: "Tech B" });
  await page.getByRole("button", { name: "Save tech", exact: true }).click();
  await expect(
    page.getByLabel("Tech on this job").locator("option:checked"),
  ).toHaveText("Tech B");

  const ctx = await browser.newContext({
    viewport: page.viewportSize() ?? undefined,
  });
  const tech = await ctx.newPage();
  await signInWithPassword(tech, "tech.b@shop-b.test");
  // Jobs list: only the assigned job.
  await tech.goto(`/app/jobs?q=${encodeURIComponent(stamp)}`);
  await expect(tech.getByText(mine, { exact: true }).first()).toBeVisible();
  await expect(tech.getByText(other, { exact: true })).toHaveCount(0);
  await auditUX(tech, true);
  await tech.goto(jobUrls[0]);
  await expect(
    tech.getByRole("button", { name: "Save tech", exact: true }),
  ).toHaveCount(0);
  await expect(
    tech.getByRole("link", { name: "+ Photo / video", exact: true }),
  ).toBeVisible();
  await expect(
    tech.getByRole("link", { name: "+ File", exact: true }),
  ).toHaveCount(0);
  await tech
    .getByRole("button", { name: "▶ Start clock", exact: true })
    .click();
  await expect(tech.getByRole("button", { name: /Stop clock/ })).toBeVisible();
  await tech.getByRole("button", { name: /Stop clock/ }).click();
  await auditUX(tech, true);
  // The other job's page doesn't open for them.
  await tech.goto(jobUrls[1]);
  await expect(
    tech.getByRole("heading", { name: other, exact: true }),
  ).toHaveCount(0);
  // Board: only their card, and no "whose jobs" filter.
  await tech.goto("/app/jobs?view=board");
  await expect(tech.getByText(other, { exact: true })).toHaveCount(0);
  await expect(tech.getByRole("group", { name: "Whose jobs" })).toHaveCount(0);
  // Owner pages and money exports are off limits.
  await tech.goto("/app/settings/booking");
  await expect(tech).toHaveURL(/\/app\/tasks$/);
  const csv = await tech.request.get("/app/money/reports/csv?report=sales");
  expect(csv.status()).toBe(404);
  await tech.goto("/app/settings");
  await expect(tech.getByText("Support access")).toHaveCount(0);
  await tech.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(tech).toHaveURL(/\/sign-in$/);
  await ctx.close();
});
