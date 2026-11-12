import { revealField } from "./helpers";
import { expect, test } from "@playwright/test";
import { signInWithPassword } from "./helpers";

test.use({ actionTimeout: 10_000 });

test("home-service setup creates a real property and equipment job without vehicle fields", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await signInWithPassword(page, "owner.a@shop-a.test");
  try {
    await page.goto("/app/jobs?new=1&full=1");
    await expect(
      page.getByRole("heading", { name: "New job", exact: true }),
    ).toBeVisible();
    await expect(page.locator("main")).not.toContainText(
      /property|equipment|materials/i,
    );
    await page.goto("/app/settings/business");
    await page
      .getByLabel("What line of business are you in?")
      .selectOption("hvac");
    await page.getByLabel(/I chose this tax rate/).check();
    await page
      .getByRole("button", { name: "Save business profile", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Business profile updated",
    );
    await page
      .locator("nav:visible")
      .getByRole("link", { name: /^(Jobs|Repair orders)$/ })
      .click();
    await expect(
      page.getByRole("link", { name: "New job", exact: true }),
    ).toBeVisible();
    const name = `HVAC ${info.project.name} ${Date.now()}`;
    await page.goto("/app/customers/new");
    await page.getByLabel("First name", { exact: true }).fill(name);
    await page
      .getByRole("button", { name: "Add customer", exact: true })
      .click();
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]+$/);
    await expect(
      page.getByRole("heading", { name: "Vehicles", exact: true }),
    ).not.toBeVisible();
    await page.getByRole("link", { name: "Properties", exact: true }).click();
    const property = page.locator("#new-property");
    await property
      .getByLabel("Property name", { exact: true })
      .fill("Main residence");
    await property
      .getByLabel("Street address", { exact: true })
      .fill("456 Service Lane");
    await property.getByLabel("City", { exact: true }).fill("Cibolo");
    await property
      .getByRole("button", { name: "Add property", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Main residence", exact: true }),
    ).toBeVisible();
    const equipment = page.locator("#new-equipment");
    await equipment
      .getByLabel("Equipment name", { exact: true })
      .fill("Upstairs AC");
    await equipment
      .getByLabel("Property", { exact: true })
      .selectOption({ label: "Main residence" });
    await equipment.getByLabel("Manufacturer", { exact: true }).fill("Carrier");
    await equipment
      .getByLabel("Serial number", { exact: true })
      .fill("HVAC-TEST-42");
    await equipment
      .getByRole("button", { name: "Add equipment", exact: true })
      .click();
    const card = page
      .getByRole("heading", { name: "Upstairs AC", exact: true })
      .locator("..");
    await expect(card).toContainText("HVAC-TEST-42");
    await card.getByText("Plan next service", { exact: true }).click();
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    await card.getByLabel("Next service date", { exact: true }).fill(day);
    await card
      .getByLabel("Service description", { exact: true })
      .fill("Seasonal AC tune-up");
    await card
      .getByLabel("Expected selling price ($, optional)", { exact: true })
      .fill("150");
    await card
      .getByRole("button", { name: "Save next service", exact: true })
      .click();
    await expect(card.getByText(/Next service:/)).toContainText(
      "Seasonal AC tune-up",
    );
    await page.goto(`/app?category=service_due&q=${encodeURIComponent(name)}`);
    const due = page.locator("article.money-opportunity");
    await expect(due).toHaveCount(1);
    await expect(due).toContainText("Seasonal AC tune-up");
    await expect(due).toContainText("456 Service Lane");
    await due.getByRole("button", { name: "Start job", exact: true }).click();
    await expect(
      page.getByLabel("Property / equipment", { exact: true }),
    ).toHaveValue(/^[a-f0-9-]{36}$/);
    await expect(page.getByLabel("Vehicle", { exact: true })).not.toBeVisible();
    await page
      .getByLabel("Job name", { exact: true })
      .fill(`AC repair ${info.project.name}`);
    await page
      .getByRole("button", { name: "Add material", exact: true })
      .click();
    await page.getByLabel("Description", { exact: true }).fill("Capacitor");
    await revealField(page, "Unit cost");
    await page.getByLabel("Unit cost", { exact: true }).fill("20");
    await page.getByLabel("Unit selling price", { exact: true }).fill("100");
    await page
      .getByRole("button", { name: "Save job sheet", exact: true })
      .click();
    const saved = page
      .getByRole("heading", {
        name: `AC repair ${info.project.name}`,
        exact: true,
      })
      .locator("xpath=ancestor::article[1]");
    await expect(saved).toBeVisible();
    await saved
      .getByRole("button", {
        name: "Prepare estimate & choose recipient",
        exact: true,
      })
      .click();
    const link = saved.getByRole("link", {
      name: "Open customer estimate",
      exact: true,
    });
    await expect(link).toBeVisible();
    await page.screenshot({
      path: `test-results/home-service-${info.project.name}.png`,
      fullPage: true,
    });
    await page.goto((await link.getAttribute("href"))!);
    await expect(
      page.getByText(/Upstairs AC, Main residence, 456 Service Lane/),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Unit cost");
  } finally {
    if (!page.isClosed()) {
      await page.goto("/app/settings/business");
      await page
        .getByLabel("What line of business are you in?")
        .selectOption("automotive");
      await page.getByLabel(/I chose this tax rate/).check();
      await page
        .getByRole("button", { name: "Save business profile", exact: true })
        .click();
      await expect(page.getByRole("status")).toContainText(
        "Business profile updated",
      );
      await page
        .locator("nav:visible")
        .getByRole("link", { name: /^(Jobs|Repair orders)$/ })
        .click();
      await expect(page.locator("main")).not.toContainText(
        /properties|equipment/i,
      );
      await page.getByRole("link", { name: "New job", exact: true }).click();
      // Back on automotive, a new RO opens as the vehicle check-in.
      await expect(
        page.getByRole("heading", {
          name: "Check in a vehicle",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Vehicle", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("link", {
          name: "Build the full job sheet instead",
          exact: true,
        })
        .click();
      await expect(
        page.getByLabel("Property / equipment", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Add part", exact: true }),
      ).toBeVisible();
      await page.getByRole("link", { name: "Customers", exact: true }).click();
      await page
        .getByRole("link", { name: "Add customer", exact: true })
        .click();
      await expect(page.locator("main")).not.toContainText(
        /property|equipment/i,
      );
      await page
        .getByRole("button", { name: "Quick find", exact: true })
        .click();
      await expect(
        page.getByRole("dialog").getByRole("textbox"),
      ).toHaveAttribute("placeholder", /VIN/);
      await page.keyboard.press("Escape");
    }
  }
});
