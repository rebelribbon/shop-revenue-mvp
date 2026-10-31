import { expect, test } from "@playwright/test";
import { signInWithPassword } from "./helpers";

const chicagoTomorrow = () => {
  const now = new Date();
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  const d = new Date(
    Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + 1),
  );
  return `${d.toISOString().slice(0, 10)}T10:30`;
};

test("M2 customer, vehicle, search and Today/Tomorrow appointment flow", async ({
  page,
}, info) => {
  const stamp = `${Date.now()}-${info.project.name}`;
  const first = `M2${stamp.slice(-8)}`;
  const last = "Customer";
  const phone = "(210) 555-0199";
  const vin =
    info.project.name === "phone" ? "1HGCM82633A004352" : "1HGCM82633A004353";
  const plate = `M2${stamp.replace(/\D/g, "").slice(-5)}`;

  await signInWithPassword(page, "owner.a@shop-a.test");
  await page.goto("/app/customers/new");
  await page.getByLabel("First name").fill(first);
  await page.getByLabel("Last name").fill(last);
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page).toHaveURL(/\/app\/customers\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("heading", { name: `${first} ${last}`, exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Vehicles", exact: true }).click();
  await page.getByLabel("Year").last().fill("2022");
  await page.getByLabel("Make").last().fill("Honda");
  await page.getByLabel("Model").last().fill("Accord");
  await page.getByLabel("VIN").last().fill(vin);
  await page.getByLabel("Plate").last().fill(plate);
  await page.getByLabel("Mileage").last().fill("48000");
  await page.getByRole("button", { name: "Add vehicle" }).click();
  await expect(page).toHaveURL(/\/vehicles\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("heading", { name: /2022 Honda Accord/ }),
  ).toBeVisible();

  await page.goto(`/app/customers?q=${vin.slice(-6)}`);
  await expect(
    page.getByRole("link", { name: `${first} ${last}`, exact: true }),
  ).toBeVisible();
  await page.goto(`/app/customers?q=${encodeURIComponent("210 555 0199")}`);
  await expect(
    page.getByRole("link", { name: `${first} ${last}`, exact: true }),
  ).toBeVisible();
  await page.goto(`/app/customers?q=${plate}`);
  await expect(
    page.getByRole("link", { name: `${first} ${last}`, exact: true }),
  ).toBeVisible();

  await page.goto("/app/schedule?new=1");
  await page
    .getByLabel("Customer", { exact: true })
    .selectOption({ label: `${first} ${last}` });
  await page.getByLabel("Date and time").fill(chicagoTomorrow());
  await page.getByLabel("Reason").fill("Brake inspection");
  await page.getByRole("button", { name: "Book visit" }).click();
  await expect(page.getByRole("status")).toContainText("Visit booked");

  const tomorrow = page
    .getByRole("heading", { name: "Tomorrow" })
    .locator("..", { hasText: `${first} ${last}` });
  await expect(tomorrow).toContainText("Brake inspection");

  await page.goto("/app/customers");
  await page
    .getByRole("link", { name: `${first} ${last}`, exact: true })
    .click();
  await expect(page.getByText(/Visit booked/)).toBeVisible();
});

test("M2 business settings are Owner editable", async ({ page }) => {
  await signInWithPassword(page, "owner.a@shop-a.test");
  await page.goto("/app/settings/business");
  await expect(
    page.getByRole("heading", { name: "Business profile" }),
  ).toBeVisible();
  await page.getByLabel("Street address").fill("123 Test Shop Rd");
  await page.getByLabel("City").fill("Austin");
  await page.getByLabel("State").fill("TX");
  await page.getByLabel("ZIP").fill("78701");
  await page.getByRole("button", { name: "Save business profile" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Business profile updated",
  );
});

test("M2 mobile navigation reaches focused job and customer creation without overflow", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "Mobile navigation only");
  await signInWithPassword(page, "owner.a@shop-a.test");
  await page.goto("/app/customers");
  const nav = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link")).toHaveCount(5);
  await nav.getByRole("link", { name: "Jobs", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Jobs", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "New job", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "New job", exact: true }),
  ).toBeVisible();
  await nav.getByRole("link", { name: "Customers", exact: true }).click();
  await page.getByRole("link", { name: "Add customer", exact: true }).click();
  await expect(page).toHaveURL(/customers\/new$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
