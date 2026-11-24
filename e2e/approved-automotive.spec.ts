import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { approvedAutomotivePoints } from "../src/lib/approved-automotive-inspection";
import { drawEstimateSignature, signInWithPassword } from "./helpers";
import { auditUX } from "./ux-audit";

async function signInAutomotive(page: Page) {
  await signInWithPassword(page, "owner.b@shop-b.test");
  await expect(page).toHaveURL(/\/automotive$/);
  await expect(page.locator("#app .app")).toBeVisible();
}

// The Automotive experience must use the approved shell with authenticated
// shop data, not the browser-only demo / fake employee switcher.
test("Automotive Settings signs out with a POST and old links recover without downloads", async ({
  page,
}) => {
  const downloads: string[] = [];
  page.on("download", (file) => downloads.push(file.suggestedFilename()));
  await signInAutomotive(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const signOut = page.getByRole("button", { name: "Sign out", exact: true });
  await expect(signOut).toBeVisible();
  const signOutBox = await signOut.boundingBox();
  expect(signOutBox!.height).toBeGreaterThanOrEqual(48);
  expect(signOutBox!.x + signOutBox!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );
  const logoutRequest = page.waitForRequest(
    (req) =>
      new URL(req.url()).pathname === "/auth/sign-out" &&
      req.method() === "POST",
  );
  await signOut.click();
  await logoutRequest;
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.goto("/automotive?view=settings");
  await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();

  await signInAutomotive(page);
  await page.goto("/auth/sign-out");
  await expect(page).toHaveURL(/\/sign-out$/);
  await expect(
    page.getByRole("heading", {
      name: "Sign out of Shop Revenue",
      exact: true,
    }),
  ).toBeVisible();
  await auditUX(page);
  // A GET is safe for prefetches: the session is still usable until POST.
  await page.getByRole("link", { name: "Keep working", exact: true }).click();
  await expect(page).toHaveURL(/\/automotive$/);
  await page.goto("/auth/sign-out");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  expect(downloads).toEqual([]);
});

test("approved Automotive interface loads real records without demo controls", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await signInAutomotive(page);
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
  await signInAutomotive(page);
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
  await signInAutomotive(page);
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
  // The successful upload immediately navigates. The response body is
  // intentionally gone by then; assert status and persisted rendered pixels.
  expect(storedMedia.status()).toBe(200);
  await expect(page).toHaveURL(/tab=media/, { timeout: 30_000 });

  // Only media actually persisted on this RO should appear after refresh.
  await page.reload();
  const evidence = page.locator(".tech-media-grid img").first();
  await expect(evidence).toBeVisible();
  await expect
    .poll(
      () => evidence.evaluate((image: HTMLImageElement) => image.naturalWidth),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);

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
  await expect(
    page.getByRole("heading", { name: "Build estimate" }),
  ).toBeVisible();
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
  await price.getByRole("button", { name: /Save repair to estimate/ }).click();
  const priceResponse = await responsePromise;
  // Saving navigates immediately to the persisted RO; the response body
  // may be discarded by Chromium before this callback reads it.
  expect(priceResponse.status()).toBe(200);
  await expect(page.getByText("Front rotor replacement").first()).toBeVisible({
    timeout: 30000,
  });
  await page.reload();
  await expect(page.getByText("Front rotor replacement").first()).toBeVisible();
  await expect(page.getByText("$225.45").first()).toBeVisible();
});

test("owner completes inspected RO through actual customer signature, repairs, invoice, payment and vehicle release", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(12_000);
  const checkpoint = (name: string) => console.log(`[AUTOMOTIVE E2E] ${name}`);
  await signInAutomotive(page);
  const post = async (operation: string, payload: Record<string, unknown>) => {
    const response = await page.request.post("/automotive/actions", {
      data: { operation, payload, clientRequestId: randomUUID() },
    });
    const result = await response.json();
    expect(result.ok, `${operation}: ${JSON.stringify(result)}`).toBe(true);
    return result.data;
  };
  const marker = randomUUID().slice(0, 12);
  const customer = await post("customer.create", {
    firstName: "EndToEnd",
    lastName: marker,
    email: `workflow-${marker}@example.test`,
    phone: "",
  });
  const vehicle = await post("vehicle.create", {
    customerId: customer.id,
    make: "Honda",
    model: "Accord",
    year: 2018,
    vin: "",
    plate: "",
    mileage: 45670,
  });
  const ro = await post("ro.checkin", {
    customerId: customer.id,
    vehicleId: vehicle.id,
    mileageIn: 45670,
    concerns: "Braking vibration during road test.",
    technicianUserId: "",
  });
  await post("inspection.save", {
    jobId: ro.id,
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
    submit: true,
    assessment: {
      diagnosis: "Brake rotor vibration confirmed during road test.",
      bay: "Bay 1",
      vehiclePickedUp: true,
    },
  });
  checkpoint("inspection complete; pricing");
  await page.goto(`/automotive?ro=${ro.id}`);
  const draftVersion = (await page.evaluate(
    `data.ros.find(r => r.id === "${ro.id}")?.version ?? ""`,
  )) as string;
  expect(draftVersion).toMatch(/^[0-9a-f-]{36}$/i);
  await post("ro.pricing.add", {
    jobId: ro.id,
    expectedVersion: draftVersion,
    description: "Replace front brake rotors",
    partsCents: 12000,
    laborCents: 9500,
    costCents: 7500,
  });
  await page.reload();
  const currentVersion = (await page.evaluate(
    `data.ros.find(r => r.id === "${ro.id}")?.version ?? ""`,
  )) as string;
  const frozen = await post("estimate.freeze", {
    jobId: ro.id,
    expectedJobVersion: currentVersion,
    taxBps: 0,
    terms: "Customer approval is required before work.",
    supplementReason: "",
  });
  expect(frozen.id).toMatch(/^[0-9a-f-]{36}$/i);
  checkpoint("estimate frozen; requesting customer link");
  const share = await post("document.prepare", {
    id: frozen.id,
    kind: "estimate",
  });
  expect(share.path).toMatch(new RegExp("^/(estimate|packet)/"));

  await page.goto(`/automotive?ro=${ro.id}&tab=proposal`);
  await expect(
    page.getByText("Estimate finalized. Sharing has not been recorded."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send finalized estimate" }),
  ).toBeVisible();
  checkpoint("customer link ready; opening unsigned portal");
  const customerContext = await browser.newContext({ baseURL: baseURL! });
  try {
    const customerPage = await customerContext.newPage();
    customerPage.setDefaultTimeout(12_000);
    const openRecorded = customerPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/proposal/open") &&
        response.status() === 204,
    );
    await customerPage.goto(share.path, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    await openRecorded;
    await page.reload();
    await expect(page.getByText(/Customer opened the proposal/)).toBeVisible();
    checkpoint("portal opened; running line approval");
    // The current customer UI presents an explicit grouped repair decision.
    // Its individual part/labor radios are intentionally hidden in a closed
    // details panel, so choose the visible "Approve this repair" control.
    for (let step = 0; step < 5; step++) {
      for (const control of await customerPage
        .getByRole("button", { name: "Approve this repair", exact: true })
        .all())
        await control.click();
      const next = customerPage.getByRole("button", { name: /^Next: / });
      if (!(await next.count())) break;
      await expect(next).toBeEnabled();
      await next.click();
    }
    checkpoint("line approval reached signature");
    await customerPage
      .getByLabel("Your full name", { exact: true })
      .fill("End To End Customer");
    await customerPage
      .getByRole("checkbox", { name: /I have reviewed/ })
      .check();
    for (const radio of await customerPage
      .getByRole("radio", { name: /^Approve / })
      .all())
      await radio.check();
    await drawEstimateSignature(customerPage);
    checkpoint("signature drawn; submitting");
    await customerPage
      .getByRole("button", { name: "Sign authorization", exact: true })
      .click();
    await expect(
      customerPage.getByRole("heading", { name: "Decision recorded" }),
    ).toBeVisible();
  } finally {
    await customerContext.close();
  }

  checkpoint("authorization recorded; checking signed RO archive");
  await page.goto(`/automotive?ro=${ro.id}&tab=documents`);
  await expect(
    page.getByRole("heading", { name: "Documents & authorization history" }),
  ).toBeVisible();
  await expect(page.getByText("Signed authorization").first()).toBeVisible();
  checkpoint("signed RO archive verified; technician repairs");
  await page.goto(`/automotive?ro=${ro.id}&tab=work`);
  const approvedLines = (await page.evaluate(
    `data.ros.find(r => r.id === "${ro.id}")?.lines.filter(l => l.decision === "approved").map(l => l.id) ?? []`,
  )) as string[];
  expect(approvedLines.length).toBeGreaterThan(0);
  for (const lineId of approvedLines) {
    await post("repair.line", {
      jobId: ro.id,
      versionId: frozen.id,
      lineId,
      started: true,
      done: true,
      notes: "Completed authorized repair and verified installation.",
    });
  }
  await post("repair.qa", {
    jobId: ro.id,
    versionId: frozen.id,
    qualityCheck: true,
    postRepairNotes: "Road tested successfully. Customer complaint resolved.",
  });
  await post("repair.finish", {
    jobId: ro.id,
    versionId: frozen.id,
  });
  await page.reload();
  await expect(
    page.getByText("Technician handoff complete").first(),
  ).toBeVisible();
  checkpoint("repair finished; issuing invoice");
  const invoice = await post("invoice.issue", {
    versionId: frozen.id,
    dueOn: "",
    terms: "Due on completion",
  });
  expect(invoice.id).toMatch(/^[0-9a-f-]{36}$/i);
  await page.reload();
  const balanceCents = (await page.evaluate(
    `data.ros.find(r => r.id === "${ro.id}")?.invoiceBalanceCents ?? 0`,
  )) as number;
  expect(balanceCents).toBeGreaterThan(0);
  await post("payment.record", {
    invoiceId: invoice.id,
    amountCents: balanceCents,
    method: "cash",
    reference: "E2E MANUAL CASH RECEIPT",
  });
  checkpoint("manual payment logged; releasing RO");
  await post("ro.release", { jobId: ro.id });
  await page.goto(`/automotive?ro=${ro.id}&tab=payment`);
  await expect(page.getByText("Vehicle released. RO closed.")).toBeVisible();
});

test("owner manages team and business details inside the unified Automotive settings", async ({
  page,
}) => {
  await signInAutomotive(page);
  await page.goto("/automotive?view=settings");
  await expect(
    page.getByRole("heading", { name: "Team & permissions" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Business profile" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "+ Invite employee" }).click();
  await expect(page.locator('.modal input[name="email"]')).toBeVisible();
  await expect(page).toHaveURL(/automotive[?]view=settings/);
});

test("Automotive settings persists business details and provides a working Billing return path", async ({
  page,
}) => {
  await signInAutomotive(page);
  await page.goto("/automotive?view=settings");
  const billing = page.getByRole("region", { name: "Billing", exact: true });
  await expect(billing).toBeVisible();
  const billingLink = billing.getByRole("link", {
    name: /free trial|billing/i,
  });
  await expect(billingLink).toHaveAttribute("href", "/automotive?view=billing");
  const box = await billingLink.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(48);
  expect(box!.x + box!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );

  const dba = page.getByRole("textbox", {
    name: "Doing business as",
    exact: true,
  });
  const original = await dba.inputValue();
  const savedName = `Saved setup ${randomUUID().slice(0, 8)}`;
  await dba.fill(savedName);
  await page
    .getByRole("checkbox", { name: /confirm this is the tax rate/ })
    .check();
  await page
    .getByRole("button", { name: "Save business settings", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Business settings saved." }),
  ).toBeVisible();
  await page.reload();
  await expect(dba).toHaveValue(savedName);
  // Restore the shared fixture before testing navigation.
  await dba.fill(original);
  await Promise.all([
    page.waitForEvent("load"),
    page
      .getByRole("button", { name: "Save business settings", exact: true })
      .click(),
  ]);
  await expect(
    page.getByRole("status").filter({ hasText: "Business settings saved." }),
  ).toBeVisible();
  await billingLink.click();
  await expect(page).toHaveURL(/\/automotive\?view=billing$/);
  await expect(
    page.getByRole("heading", { name: "Billing", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Back to settings", exact: true })
    .click();
  await expect(page).toHaveURL(/\/automotive\?view=settings$/);
  await expect(billing).toBeVisible();
});

for (const lifetime of [false, true])
  test(`Billing keeps the unified layout for ${lifetime ? "lifetime-free trials" : "trial signup"} and legacy return links`, async ({
    page,
  }, info) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await signInAutomotive(page);
    const setup = {
      kind: lifetime ? "full" : "setup",
      blocked: !lifetime,
      trialUsed: lifetime,
      trialEndsAt: lifetime ? "2026-12-07T11:08:12Z" : null,
    };
    // Keep real routing, authentication, the server shell and its bridge. Only
    // replace this disposable test's provider snapshot to cover both screenshots
    // without creating a live Stripe subscription or spending the coupon.
    await page.route("**/automotive?view=billing*", async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      const start = html.indexOf("let data=") + "let data=".length;
      const end = html.indexOf(";let ui=", start);
      expect(start).toBeGreaterThan("let data=".length);
      expect(end).toBeGreaterThan(start);
      const data = JSON.parse(html.slice(start, end));
      data.billingSetup = setup;
      data.billingDetail = {
        ...setup,
        canAct: true,
        cancelAt: null,
        currentPeriodEnd: lifetime ? "2026-12-07T11:08:12Z" : null,
        lockAt: null,
        paymentFailed: false,
        pricing: {
          baseLabel: "$49.99/month",
          recurringLabel: lifetime ? "$0/month" : "$49.99/month",
          discountLabel: lifetime ? "100% off forever" : null,
          freeForever: lifetime,
        },
      };
      await route.fulfill({
        response,
        body:
          html.slice(0, start) +
          JSON.stringify(data).replaceAll("<", "\\u003c") +
          html.slice(end),
      });
    });
    await page.goto(`/app/settings/billing${lifetime ? "?started=1" : ""}`);
    await expect(page).toHaveURL(
      lifetime
        ? /\/automotive\?view=billing&started=1$/
        : /\/automotive\?view=billing$/,
    );
    await expect(
      page.getByRole("heading", { name: "Billing", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#app .app .topbar")).toBeVisible();
    await expect(page.locator(".workspace-header")).toHaveCount(0);
    const primary = page.locator(".billing-page .btn.primary");
    await expect(primary).toHaveCount(1);
    if (lifetime) {
      await expect(
        page.getByText("Lifetime free", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("100% off forever", { exact: true }),
      ).toBeVisible();
      await expect(page.locator(".billing-price")).toHaveText("$0/month");
      await expect(page.locator(".billing-dates")).toContainText(
        "Your lifetime discount keeps the subscription at $0 after the trial.",
      );
      await expect(page.getByText(/Your card will be charged/)).toHaveCount(0);
    } else {
      await expect(primary).toHaveText("Start free trial");
      await expect(page.locator(".billing-dates")).toContainText(
        "promotion code at checkout",
      );
    }
    await page.screenshot({
      path: `artifacts/billing-${lifetime ? "lifetime" : "signup"}-${info.project.name}.png`,
      fullPage: true,
    });
    if (info.project.name === "phone")
      await page.setViewportSize({ width: 320, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    for (const target of await page
      .locator(".billing-page .btn, .topbar .btn")
      .all()) {
      const box = await target.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(48);
      expect(box!.width).toBeGreaterThanOrEqual(48);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(
        page.viewportSize()!.width + 1,
      );
    }
    const actions: string[] = [];
    await page.route("**/automotive/actions", async (route) => {
      actions.push(route.request().postDataJSON().operation);
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: { message: "Stripe is temporarily unavailable. Try again." },
        }),
      });
    });
    await primary.click();
    await expect(page.getByRole("alert")).toHaveText(
      "Stripe is temporarily unavailable. Try again.",
    );
    await expect(primary).toBeEnabled();
    expect(actions).toEqual([lifetime ? "billing.portal" : "billing.start"]);
    await page
      .getByRole("link", { name: "Back to settings", exact: true })
      .click();
    await expect(page).toHaveURL(/\/automotive\?view=settings$/);
    expect(pageErrors).toEqual([]);
  });

test("owner can find Stripe setup in current settings while staff cannot manage the connection", async ({
  page,
}) => {
  await signInAutomotive(page);
  const settingsLink = page.getByRole("link", {
    name: "Settings",
    exact: true,
  });
  await expect(settingsLink).toBeVisible();
  const settingsBox = await settingsLink.boundingBox();
  expect(settingsBox!.height).toBeGreaterThanOrEqual(48);
  expect(settingsBox!.x + settingsBox!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );
  await settingsLink.click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  const payments = page.getByRole("region", { name: "Online payments" });
  await expect(payments).toBeVisible();
  await expect(payments).toContainText(
    "directly into your shop’s connected Stripe account",
  );
  await expect(
    payments.getByRole("button", { name: "Connect Stripe", exact: true }),
  ).toBeDisabled();
  await expect(payments.getByRole("status")).toContainText(
    "Shop Revenue is still activating",
  );
  const refresh = payments.getByRole("button", {
    name: "Check setup status",
    exact: true,
  });
  await Promise.all([page.waitForEvent("load"), refresh.click()]);
  await expect(page).toHaveURL(/automotive\?view=settings$/);
  await expect(
    payments.getByRole("button", { name: "Connect Stripe", exact: true }),
  ).toBeDisabled();
  const box = await refresh.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(48);
  const viewport = page.viewportSize()!;
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);

  await page.request.post("/auth/sign-out");
  await signInWithPassword(page, "staff.b@shop-b.test");
  await expect(page).toHaveURL(/\/automotive$/);
  await expect(page.locator("#app .app")).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Online payments", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Billing", exact: true }),
  ).toHaveCount(0);
  await page.goto("/automotive?view=billing");
  await expect(page).toHaveURL(/\/automotive\?view=settings$/);
  await expect(page.locator(".billing-price")).toHaveCount(0);
  for (const operation of [
    "payments.connect",
    "payments.refresh",
    "billing.start",
    "billing.portal",
  ]) {
    const response = await page.request.post("/automotive/actions", {
      data: { operation, payload: {} },
    });
    expect(response.status()).toBe(403);
    expect((await response.json()).error.message).toContain(
      "Only the shop owner",
    );
  }
});

test("bookmarked Automotive RO list and check-in links open the unified workflow", async ({
  page,
}) => {
  await signInAutomotive(page);
  await page.goto("/app/jobs");
  await expect(page).toHaveURL(/\/automotive\?view=jobs$/);
  await expect(
    page.getByRole("heading", { name: "Repair orders" }),
  ).toBeVisible();
  await page.goto("/app/jobs?new=1");
  await expect(page).toHaveURL(/\/automotive\?new=1$/);
  await expect(page.locator(".modal")).toContainText(
    "New repair order — check-in",
  );
  await expect(page.locator(".modal")).toContainText(
    "Detailed pricing happens only after inspection.",
  );
});
