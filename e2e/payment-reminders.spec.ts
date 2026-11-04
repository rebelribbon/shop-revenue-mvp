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
});
