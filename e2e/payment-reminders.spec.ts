import { expect, test } from "@playwright/test";
import { signInWithPassword } from "./helpers";
import { auditUX } from "./ux-audit";

test("Owner turns automatic payment reminders on and off", async ({ page }) => {
  await signInWithPassword(page, "owner.b@shop-b.test");
  await page.goto("/app/settings/follow-ups");
  const box = page.getByRole("region", {
    name: "Automatic payment reminders",
  });
  await expect(box).toBeVisible();
  await auditUX(page, true);
  await box.getByRole("radio", { name: "On" }).check();
  await box.getByLabel("Send one every").fill("2");
  await box.getByRole("button", { name: "Save reminders" }).click();
  await expect(box.getByText(/Reminders on: every 2 days/)).toBeVisible();
  await page.reload();
  await expect(page.locator("main#main-content")).toHaveAttribute(
    "data-ux-ready",
    "true",
  );
  await expect(box.getByRole("radio", { name: "On" })).toBeChecked();
  await expect(box.getByLabel("Send one every")).toHaveValue("2");
  await box.getByRole("radio", { name: "Off" }).check();
  await box.getByRole("button", { name: "Save reminders" }).click();
  await expect(box.getByText("Automatic reminders are off.")).toBeVisible();

  // Review requests: a real link is required, then it can be turned on.
  const reviews = page.getByRole("region", { name: "Ask for reviews" });
  await reviews
    .getByLabel("Your review link")
    .fill("https://g.page/r/e2e-test/review");
  await reviews.getByRole("radio", { name: "On" }).check();
  await reviews.getByRole("button", { name: "Save review settings" }).click();
  await expect(reviews.getByText(/Review requests on/)).toBeVisible();
  await auditUX(page, true);
  // Customer profiles now offer "Ask for a review".
  await page.goto("/app/customers/new");
  await page.getByLabel("First name").fill("Review");
  await page.getByLabel("Last name").fill(`TEST ${Date.now()}`);
  await page
    .getByLabel("Email", { exact: true })
    .fill(`review-${Date.now()}@example.test`);
  await page.getByLabel("How did they find you?").selectOption("referral");
  await page.getByLabel(/Who referred them/).fill("Sam TEST");
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);
  await expect(page.getByLabel("How did they find you?")).toHaveValue(
    "referral",
  );
  await expect(page.getByLabel(/Details/)).toHaveValue("Sam TEST");
  await expect(
    page.getByRole("heading", { name: "Review", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "★ Ask for a review" }),
  ).toBeVisible();
  await auditUX(page, true);
  // Monday summary: on by default; send one now.
  await page.goto("/app/settings/follow-ups");
  const weekly = page.getByRole("region", { name: "Monday summary" });
  await expect(weekly.getByRole("radio", { name: "On" })).toBeChecked();
  await weekly
    .getByRole("button", { name: "Email me last week’s summary now" })
    .click();
  await expect(
    weekly.getByText(/Summary emailed to|couldn’t be sent right now/),
  ).toBeVisible();
  await auditUX(page, true);
  // Reports can group by where customers found you.
  await page.goto(
    "/app/money/reports/build?source=sales&group=source&measures=total",
  );
  await expect(page.getByText(/by lead source/i).first()).toBeVisible();
  await auditUX(page, true);
  // Deposits: owner sets an amount and percentage.
  await page.goto("/app/settings/invoices");
  const deposits = page.getByRole("region", { name: "Deposits" });
  await deposits.getByRole("radio", { name: "On" }).check();
  await deposits.getByLabel(/On approved work of at least/).fill("750");
  await deposits.getByLabel(/Deposit \(%/).fill("30");
  await deposits.getByRole("button", { name: "Save deposits" }).click();
  await expect(
    deposits.getByText("Deposits on: 30% on approved work of $750 or more."),
  ).toBeVisible();
  await auditUX(page, true);
  // Reload so the saved setting is what the form starts from.
  await page.reload();
  await expect(page.locator("main#main-content")).toHaveAttribute(
    "data-ux-ready",
    "true",
  );
  await expect(deposits.getByRole("radio", { name: "On" })).toBeChecked();
  await deposits.getByRole("radio", { name: "Off" }).check();
  await deposits.getByRole("button", { name: "Save deposits" }).click();
  await expect(deposits.getByText("Deposits are off.")).toBeVisible();
});
