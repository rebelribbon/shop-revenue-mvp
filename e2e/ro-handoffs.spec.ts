import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./helpers";
import { auditUX } from "./ux-audit";

test("keeps the desktop RO view switch clear of the current action", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Desktop layout acceptance");
  await page.goto("/desktop-demo?screen=ro&mode=internal");
  const switcher = page.locator('[aria-label="Repair order view selector"]');
  await expect(
    switcher.getByRole("link", { name: "Customer", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-ux-primary]")).toHaveCSS(
    "position",
    "static",
  );
  const bounds = await switcher.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height,
  );
});

test("routes an assigned inspection from the technician to its advisor without exposing office controls", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180_000);
  await signInWithPassword(page, "owner.b@shop-b.test");
  const title = `Assigned inspection ${info.project.name} ${Date.now()}`;
  await page.goto("/app/customers/new");
  await page.getByLabel("First name").fill(title);
  await page
    .getByLabel("Mobile number", { exact: true })
    .fill(
      `+1210555${String(Date.now()).slice(-3)}${info.project.name === "phone" ? 1 : 2}`,
    );
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  await expect(page).toHaveURL(/customers\/[0-9a-f-]+$/);
  const customerUrl = page.url();
  await page.getByRole("link", { name: "Vehicles", exact: true }).click();
  await page.getByLabel("Make", { exact: true }).fill("Ford");
  await page.getByRole("button", { name: "Add vehicle", exact: true }).click();
  await expect(page).toHaveURL(/vehicles\/[0-9a-f-]+$/);
  await page.getByRole("link", { name: "+ New RO", exact: true }).click();
  await page.getByLabel("Job name").fill(title);
  await page.getByRole("button", { name: "Add labor", exact: true }).click();
  await page
    .getByLabel("Description", { exact: true })
    .fill("Diagnose customer concern");
  await page.getByLabel("Quoted hours", { exact: true }).fill("1");
  await page.getByLabel("Hourly selling rate", { exact: true }).fill("100");
  await page
    .getByRole("button", { name: "Save job sheet", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  const jobId = new URL(page.url()).searchParams.get("job")!;
  expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
  await page
    .getByLabel("Service advisor for this RO")
    .selectOption({ label: "Staff B" });
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/app/jobs"),
    ),
    page.getByRole("button", { name: "Assign advisor", exact: true }).click(),
  ]);
  await page.reload();
  await expect(
    page.getByLabel("Service advisor for this RO").locator("option:checked"),
  ).toHaveText("Staff B");
  await page.getByLabel("Tech on this job").selectOption({ label: "Tech B" });
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/app/jobs"),
    ),
    page.getByRole("button", { name: "Save tech", exact: true }).click(),
  ]);
  await page.reload();
  await expect(
    page.getByLabel("Tech on this job").locator("option:checked"),
  ).toHaveText("Tech B");

  const techContext = await browser.newContext({
    baseURL,
    viewport: page.viewportSize()!,
  });
  const advisorContext = await browser.newContext({
    baseURL,
    viewport: page.viewportSize()!,
  });
  try {
    const tech = await techContext.newPage();
    const advisor = await advisorContext.newPage();
    await signInWithPassword(tech, "tech.b@shop-b.test");
    await signInWithPassword(advisor, "staff.b@shop-b.test");
    for (const blocked of [
      "/app/customers",
      customerUrl,
      "/app/invoices",
      "/app/money",
      "/app/settings/team",
    ]) {
      await tech.goto(blocked);
      await expect(tech).toHaveURL(/\/app\/tasks$/);
    }
    await expect(
      tech.getByRole("link", { name: "Customers", exact: true }),
    ).toHaveCount(0);
    await expect(
      tech.getByRole("link", { name: "Reports", exact: true }),
    ).toHaveCount(0);
    await expect(
      tech.getByRole("link", { name: "Appointments", exact: true }),
    ).toHaveCount(0);
    const readTasks = async (p: typeof page) => {
      const response = await p.request.get("/api/ro-handoffs");
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toContain("no-store");
      return (await response.json()).tasks as {
        id: string;
        jobId: string;
        title: string;
      }[];
    };
    expect((await readTasks(tech)).some((task) => task.jobId === jobId)).toBe(
      true,
    );
    expect(
      (await readTasks(advisor)).some((task) => task.jobId === jobId),
    ).toBe(false);
    await tech.goto(`/app/jobs?job=${jobId}`);
    await expect(
      tech.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      tech.getByText("40-point inspection", { exact: true }),
    ).toBeVisible();
    await expect(tech.getByLabel("Tech on this job")).toHaveCount(0);
    await expect(
      tech.getByRole("button", {
        name: /Send estimate|Create invoice|Record payment/,
      }),
    ).toHaveCount(0);
    await tech
      .getByLabel("I have picked up the vehicle for assessment", {
        exact: true,
      })
      .check();
    await tech.getByLabel("Bay / rack", { exact: true }).fill("Bay 2");
    await tech
      .getByLabel("Technician diagnosis", { exact: true })
      .fill("Road tested the customer concern. No additional faults found.");
    await Promise.all([
      tech.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().includes("/app/jobs"),
      ),
      tech.getByRole("button", { name: "Save progress", exact: true }).click(),
    ]);
    await tech.reload();
    await expect(
      tech.getByRole("button", { name: "Submit inspection → Notify advisor" }),
    ).toBeDisabled();
    await expect(tech.getByLabel("Bay / rack", { exact: true })).toHaveValue(
      "Bay 2",
    );
    await expect(
      tech.getByLabel("Technician diagnosis", { exact: true }),
    ).toHaveValue(
      "Road tested the customer concern. No additional faults found.",
    );
    // Each category is a separate page; all 40 results must be explicit.
    for (let category = 0; category < 9; category++) {
      for (const satisfactory of await tech
        .getByRole("radio", { name: "Satisfactory", exact: true })
        .all())
        await satisfactory.check();
      if (category < 8)
        await tech
          .getByRole("button", { name: "Next category →", exact: true })
          .click();
    }
    await expect(
      tech.getByText("40 of 40 checked", { exact: false }),
    ).toBeVisible();
    await tech
      .getByRole("button", {
        name: "Submit inspection → Notify advisor",
        exact: true,
      })
      .click();
    await expect(
      tech.getByText("Inspection submitted to your advisor.", { exact: true }),
    ).toBeVisible();
    expect((await readTasks(tech)).some((task) => task.jobId === jobId)).toBe(
      false,
    );
    expect(
      (await readTasks(advisor)).some((task) => task.jobId === jobId),
    ).toBe(true);
    expect((await readTasks(page)).some((task) => task.jobId === jobId)).toBe(
      false,
    );
    await advisor.goto("/app/tasks");
    const task = advisor
      .locator("li.task-item")
      .filter({ has: advisor.locator(`a[href='/app/jobs?job=${jobId}']`) });
    await expect(task).toContainText("Inspection complete");
    await task
      .getByRole("link", { name: "Build estimate", exact: true })
      .click();
    await expect(
      advisor.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await tech.reload();
    await expect(
      tech.getByRole("button", { name: "Save progress", exact: true }),
    ).toHaveCount(0);
    await auditUX(tech);
    await tech.screenshot({
      path: `test-results/ux-technician-handoff-${info.project.name}.png`,
      fullPage: true,
    });
  } finally {
    await techContext.close();
    await advisorContext.close();
  }
});
