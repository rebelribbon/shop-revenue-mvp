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
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);
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
});
