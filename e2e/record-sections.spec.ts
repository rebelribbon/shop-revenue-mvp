import { expect, test } from "@playwright/test";

test("customer search, directory and profile information have distinct panels", async ({
  page,
}, info) => {
  await page.goto("/demo/crm");
  const search = page.getByRole("region", {
    name: "Find a customer",
    exact: true,
  });
  const directory = page.getByRole("region", {
    name: "Customer directory",
    exact: true,
  });
  await expect(search).toBeVisible();
  await expect(directory.locator(".customer-directory-row")).toHaveCount(4);
  for (const card of await directory.locator(".customer-directory-row").all()) {
    expect(
      await card.evaluate((el) =>
        Math.abs(
          el.getBoundingClientRect().width -
            el.parentElement!.getBoundingClientRect().width,
        ),
      ),
    ).toBeLessThanOrEqual(1);
  }
  const searchBounds = await search.boundingBox();
  const directoryBounds = await directory.boundingBox();
  expect(directoryBounds!.y).toBeGreaterThanOrEqual(
    searchBounds!.y + searchBounds!.height + 16,
  );
  await search.getByRole("searchbox").fill("Jordan");
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(directory.locator(".customer-directory-row")).toHaveCount(1);
  await directory.getByRole("link", { name: /Jordan Sample/ }).click();
  await expect(
    page.getByRole("heading", { name: "Jordan Sample", exact: true }),
  ).toBeVisible();
  for (const name of [
    "Account summary",
    "Active ROs",
    "Vehicles",
    "Recent activity",
  ]) {
    const panel = page.getByRole("region", { name, exact: true });
    await expect(panel).toBeVisible();
    await expect(panel).toHaveCSS("border-top-style", "solid");
    expect(
      await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
  }
  const identity = page.locator(".customer-hero-identity");
  const contact = identity.locator(".customer-contact-summary");
  await expect(contact.locator("dd")).toHaveText([
    "(210) 555-0111",
    "jordan@example.test",
    "200 Example Lane, San Antonio, TX 78201",
  ]);
  const nameBounds = await identity.getByRole("heading").boundingBox();
  const contactBounds = await contact.boundingBox();
  const assetBounds = await identity
    .locator(".customer-hero-asset")
    .boundingBox();
  expect(contactBounds!.y).toBeGreaterThanOrEqual(
    nameBounds!.y + nameBounds!.height + 8,
  );
  expect(assetBounds!.y).toBeGreaterThanOrEqual(
    contactBounds!.y + contactBounds!.height + 8,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/customer-panels-${info.project.name}.png`,
    fullPage: true,
  });
});

test("ROs are grouped by work state and open the matching customer's pricing", async ({
  page,
}, info) => {
  await page.goto("/demo/crm?view=jobs");
  const attention = page.getByRole("region", {
    name: "Needs attention",
    exact: true,
  });
  const active = page.getByRole("region", { name: "In progress", exact: true });
  const closed = page.getByRole("region", { name: "Closed work", exact: true });
  await expect(attention.locator(".record-work-card")).toHaveCount(2);
  await expect(active.locator(".record-work-card")).toHaveCount(1);
  await expect(closed.locator(".record-work-card")).toHaveCount(1);
  await expect(attention).toContainText("Alex Example");
  await expect(active).toContainText("Jordan Sample");
  await expect(closed).toContainText("Taylor Demo");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/ro-panels-${info.project.name}.png`,
    fullPage: true,
  });
  await active
    .getByRole("link", { name: "Open RO 10043 for Jordan Sample" })
    .click();
  for (const name of ["RO details", "Parts & labor", "Price summary"]) {
    await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
  }
  await expect(
    page.getByRole("textbox", { name: "Customer", exact: true }),
  ).toHaveValue("Jordan Sample");
  const before = await page.locator(".demo-job-grand strong").textContent();
  await page.getByRole("spinbutton", { name: "Unit price 3" }).fill("240");
  await expect(page.locator(".demo-job-grand strong")).not.toHaveText(before!);
  await page.screenshot({
    path: `test-results/ro-pricing-panels-${info.project.name}.png`,
    fullPage: true,
  });
});
