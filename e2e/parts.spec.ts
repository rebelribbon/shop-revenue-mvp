import { expect, test } from "@playwright/test";
import { signInWithPassword } from "./helpers";
import { auditUX } from "./ux-audit";

test("Parts: add, receive, count, and pick one on a job", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const name = `Pads TEST ${info.project.name} ${Date.now()}`;
  await signInWithPassword(page, "owner.b@shop-b.test");
  await page.goto("/app/parts");
  await auditUX(page, true);
  await page.getByRole("link", { name: "+ Add part" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel(/Your cost, each/).fill("40");
  await page.getByLabel("Selling price, each").fill("90");
  await page.getByLabel("How many on the shelf now").fill("5");
  await page.getByLabel(/Warn me when/).fill("2");
  await auditUX(page, true);
  await page.getByRole("button", { name: "Add part" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  const stock = page.getByLabel("Stock", { exact: true });
  await expect(stock).toContainText("5 on the shelf");
  await auditUX(page, true);

  await page.getByLabel("How many", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Add to stock" }).click();
  await expect(stock).toContainText("8 on the shelf");
  await page.getByLabel("How many are there").fill("1");
  await page.getByRole("button", { name: "Save count" }).click();
  await expect(stock).toContainText("time to reorder");
  await expect(page.getByLabel("Stock history")).toContainText("Shelf count");

  await page.goto(`/app/parts?q=${encodeURIComponent(name)}`);
  await expect(page.getByText(/running low/)).toBeVisible();

  // Pick it on a new job: prices fill in from the list.
  await page.goto("/app/jobs?new=1");
  await page.getByRole("button", { name: "Add part", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill(name);
  await expect(page.getByText(/From your list · 1 on the shelf/)).toBeVisible();
  await expect(
    page.getByLabel("Unit selling price", { exact: true }),
  ).toHaveValue(/^90(\.00)?$/);

  // Quick sale at the counter: no job, stock comes off, then void it.
  await page.goto("/app/checkout");
  await page.getByRole("link", { name: "ring up a quick sale" }).click();
  await expect(page.getByRole("heading", { name: "Quick sale" })).toBeVisible();
  const pick = page.getByLabel("Add a part from your list");
  const value = await pick
    .locator("option")
    .filter({ hasText: name })
    .getAttribute("value");
  await pick.selectOption(value!);
  await page.getByRole("radio", { name: /Cash/ }).check();
  await auditUX(page, true);
  await page
    .getByRole("group", { name: "Cash received" })
    .getByRole("button")
    .last()
    .click();
  await expect(page.getByText(/Change due:/)).toBeVisible();
  await page.getByRole("button", { name: /^Take \$/ }).click();
  await expect(page.getByText(/^Sale #\d+$/)).toBeVisible();
  await page.getByRole("link", { name: "Receipt" }).click();
  await expect(
    page.getByRole("heading", { name: /^Sale #\d+$/ }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Receipt" })).toContainText(
    name,
  );
  await auditUX(page, true);
  await page.getByText("Void this sale").click();
  await page.getByLabel("Why?").fill("TEST void");
  await page.getByRole("button", { name: "Void sale" }).click();
  await page.getByRole("button", { name: "Yes, continue" }).click();
  await expect(page.getByText("Voided: TEST void")).toBeVisible();
});
