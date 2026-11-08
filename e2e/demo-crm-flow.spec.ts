import { expect, test } from "@playwright/test";

test("public CRM buttons open working customer and job pricing demos", async ({
  page,
}, info) => {
  await page.goto("/demo/crm");
  await expect(page.getByRole("link", { name: "+ Customer" })).toBeVisible();
  await expect(page.locator("[data-ux-primary]")).toHaveCount(0);
  await page.getByRole("link", { name: "+ Customer" }).click();
  await expect(
    page.getByRole("heading", { name: "Add customer" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "First name" }).fill("Demo");
  await page.getByRole("textbox", { name: "Last name" }).fill("Tester");
  await page.getByRole("button", { name: "Save demo customer" }).click();
  await expect(page.getByText("Customer created in this demo")).toBeVisible();
  await page.getByRole("link", { name: "+ Set up job & pricing" }).click();
  await expect(page.getByRole("heading", { name: "Job Setup" })).toBeVisible();

  const before = await page.locator(".demo-job-grand strong").textContent();
  await page.getByRole("spinbutton", { name: "Unit price 3" }).fill("220");
  await expect(page.locator(".demo-job-grand strong")).not.toHaveText(
    before || "",
  );
  await page.getByRole("button", { name: "Next: Preview Documents" }).click();
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await expect(page.getByText("Brake labor × 3")).toBeVisible();
  await page.getByRole("button", { name: "Preview customer view" }).click();
  await expect(
    page.getByRole("heading", { name: "Customer approval preview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next: Share packet" }).click();
  await expect(
    page.getByRole("heading", { name: "Share customer packet" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preview send confirmation" }).click();
  await expect(page.getByText("Packet ready to share")).toBeVisible();
  await expect(
    page.getByText("No email was sent", { exact: false }),
  ).toBeVisible();

  if (info.project.name === "phone") {
    for (const el of await page
      .locator(".demo-job-bottom-actions .btn")
      .all()) {
      const rect = await el.boundingBox();
      expect(rect).not.toBeNull();
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
    }
  }
});

test("demo navigation doesn't cover customers and can jump directly to pricing", async ({
  page,
}) => {
  await page.goto("/demo/crm");
  const nav = page.getByRole("navigation", {
    name: "Mobile sample navigation",
  });
  if (await nav.isVisible()) {
    await page
      .locator("main.crm-sample")
      .evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(
      page.locator(".customer-directory-row").last(),
    ).toBeInViewport();
    const last = await page
      .locator(".customer-directory-row")
      .last()
      .boundingBox();
    const bottom = await nav.boundingBox();
    expect(last).not.toBeNull();
    expect(bottom).not.toBeNull();
    expect(last!.y + last!.height).toBeLessThanOrEqual(bottom!.y - 8);
  }
  await page.getByRole("link", { name: "Try job setup & pricing" }).click();
  await expect(page.getByRole("heading", { name: "Job Setup" })).toBeVisible();
  await page.getByRole("button", { name: "4. Payment" }).click();
  await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
});
