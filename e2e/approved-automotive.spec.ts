import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { approvedAutomotivePoints } from "../src/lib/approved-automotive-inspection";
import { signInWithPassword } from "./helpers";

// The Automotive experience must use the approved shell with authenticated
// shop data, not the browser-only demo / fake employee switcher.
test("approved Automotive interface loads real records without demo controls", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await signInWithPassword(page, "owner.b@shop-b.test");
  await page.goto("/automotive");
  await expect(page.locator("#app .app")).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("heading", { name: /Good afternoon|My workbench/ }),
  ).toBeVisible();
  await expect(page.getByText("Offline preview")).toHaveCount(0);
  await expect(
    page.locator("button[onclick*=\"openModal('role')\"]"),
  ).toHaveCount(0);
  await expect(page.getByText("INTERACTIVE DESIGN PROTOTYPE")).toHaveCount(0);
  const customerNav = page
    .locator(".nav-item:visible, .screen-mobile-nav button:visible")
    .filter({ hasText: "Customers" })
    .first();
  await customerNav.click();
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "+ Add customer" }),
  ).toBeVisible();
  expect(pageErrors, `Browser errors in ${info.project.name}`).toEqual([]);
});

test("Automotive creates a real customer and keeps it after reload", async ({
  page,
}, info) => {
  test.setTimeout(150_000);
  const key = `Unified ${info.project.name} ${Date.now()}`;
  await signInWithPassword(page, "owner.b@shop-b.test");
  await page.goto("/automotive");
  await expect(page.locator("#app .app")).toBeVisible();
  await page
    .locator(".nav-item:visible, .screen-mobile-nav button:visible")
    .filter({ hasText: "Customers" })
    .first()
    .click();
  await page.getByRole("button", { name: "+ Add customer" }).click();
  const modal = page.locator(".modal");
  await modal.locator('input[name="name"]').fill(key);
  // Both device projects write to the same shop: use distinct phone numbers
  // so customer duplicate protection is not mistaken for a UI failure.
  const suffix = String(Date.now() % 10000).padStart(4, "0");
  await modal.locator('input[name="phone"]').fill(`+1210555${suffix}`);
  await modal
    .locator('input[name="email"]')
    .fill(`unified-${Date.now()}@example.test`);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/automotive/actions") &&
      response.request().method() === "POST",
  );
  await modal.getByRole("button", { name: "Create customer" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  await expect(page).toHaveURL(/\/automotive\?customer=[0-9a-f-]{36}/, {
    timeout: 30000,
  });
  await expect(page.getByRole("heading", { name: key })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: key })).toBeVisible();
});

test("solo shop owner can create and inspect an RO without assigning separate staff", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signInWithPassword(page, "owner.b@shop-b.test");
  await page.goto("/automotive");
  const post = async (operation: string, payload: Record<string, unknown>) => {
    const response = await page.request.post("/automotive/actions", {
      data: { operation, payload, clientRequestId: randomUUID() },
    });
    const body = await response.json();
    expect(body.ok, JSON.stringify(body)).toBe(true);
    expect(response.status()).toBe(200);
    return body.data;
  };
  const marker = randomUUID().slice(0, 12);
  const customer = await post("customer.create", {
    firstName: "Solo",
    lastName: marker,
    phone: "",
    email: `solo-${marker}@example.test`,
  });
  const vehicle = await post("vehicle.create", {
    customerId: customer.id,
    year: 2019,
    make: "Honda",
    model: "Civic",
    vin: "",
    plate: "",
    mileage: 88000,
  });
  const ro = await post("ro.checkin", {
    customerId: customer.id,
    vehicleId: vehicle.id,
    mileageIn: 88000,
    concerns: "Customer reports a vibration under braking.",
    // Intentionally no separate advisor or technician.
    technicianUserId: "",
  });
  expect(ro.id).toMatch(/^[0-9a-f-]{36}$/i);
  await page.goto(`/automotive?ro=${ro.id}`);
  await expect(page.locator("#app .app")).toBeVisible();
  await expect(
    page.getByText("Customer reports a vibration under braking.").first(),
  ).toBeVisible();

  // Exercise the approved technician photo picker with an actual PNG,
  // including signed storage, association to this RO, and readback.
  await page.goto(`/automotive?ro=${ro.id}&tab=diagnosis`);
  const upload = page.locator('.tech-upload input[type="file"]').first();
  await expect(upload).toBeAttached();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/SPoAAAAASUVORK5CYII=",
    "base64",
  );
  const finishUpload = page.waitForResponse(
    (response) =>
      response.url().endsWith("/automotive/actions") &&
      response.request().postData()?.includes('"media.finish"') === true,
    { timeout: 30_000 },
  );
  await upload.setInputFiles({
    name: "diagnostic-evidence.png",
    mimeType: "image/png",
    buffer: png,
  });
  const storedMedia = await finishUpload;
  expect(await storedMedia.json()).toMatchObject({ ok: true });
  await expect(page).toHaveURL(/tab=media/, { timeout: 30_000 });

  // Only media actually persisted on this RO should appear after refresh.
  await page.reload();
  const evidence = page.locator('.tech-media-grid img').first();
  await expect(evidence).toBeVisible();
  await expect.poll(
    () => evidence.evaluate((image: HTMLImageElement) => image.naturalWidth),
    { timeout: 15_000 },
  ).toBeGreaterThan(0);

  const inspection = await post("inspection.save", {
    jobId: ro.id,
    submit: true,
    items: JSON.stringify(
      approvedAutomotivePoints.map((p) => ({
        ...p,
        status: "good",
        note: "",
        recommendedWork: "",
        hoursHundredths: 100,
        addedToJob: false,
      })),
    ),
    assessment: {
      diagnosis: JSON.stringify({
        confirmed: "yes",
        codes: "None",
        symptoms: "Customer reports braking vibration.",
        tests: "Road test and all approved 40 checks completed.",
        cause: "No active issue observed during inspection.",
        recommendation: "No repair recommended.",
      }),
      bay: "Bay 1",
      vehiclePickedUp: true,
    },
  });
  expect(inspection.complete).toBe(true);
  await page.reload();
  await expect(page.locator("#app .app")).toBeVisible();
  await expect(
    page.getByText("Customer reports a vibration under braking.").first(),
  ).toBeVisible();
  // Operate the actual advisor pricing form (rather than calling its API)
  // and verify the saved work is still present after a full reload.
  await page.goto(`/automotive?ro=${ro.id}&tab=estimate`);
  await expect(page.getByRole("heading", { name: "Build estimate" })).toBeVisible();
  const price = page.locator('form[onsubmit*="addLine"]');
  await price.locator('input[name="name"]').fill("Front rotor replacement");
  await price.locator('input[name="parts"]').fill("225.45");
  await price.locator('input[name="labor"]').fill("150.50");
  await price.locator('input[name="cost"]').fill("125.00");
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/automotive/actions") &&
      response.request().method() === "POST" &&
      response.request().postData()?.includes('"ro.pricing.add"') === true,
  );
  await price.getByRole("button", { name: /Add recommendation/ }).click();
  const priceResponse = await responsePromise;
  expect(await priceResponse.json()).toMatchObject({ ok: true });
  await expect(
    page.getByText("Front rotor replacement").first(),
  ).toBeVisible({ timeout: 30000 });
  await page.reload();
  await expect(
    page.getByText("Front rotor replacement").first(),
  ).toBeVisible();
  await expect(page.getByText("$225.45").first()).toBeVisible();

});
