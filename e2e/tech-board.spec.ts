import { expect, test } from "@playwright/test";
import { signInWithPassword } from "./helpers";
import { auditUX } from "./ux-audit";

// Tomorrow at 10:00 in the shop's time zone, for a datetime-local input.
const chicagoTomorrow = () => {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
  }).format(new Date(Date.now() + 86400000));
  return `${day}T10:00`;
};

test("Dispatch technician work and keep the owner board and appointments aligned", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const name = `Tech ${info.project.name} ${Date.now()}`;
  await signInWithPassword(page, "owner.b@shop-b.test");
  await page.goto("/app/customers/new");
  await page.getByLabel("First name").fill("Tech");
  await page.getByLabel("Last name").fill(`TEST ${info.project.name}`);
  await page.getByLabel("Assigned service advisor").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  await expect(page).toHaveURL(/customers\/[0-9a-f-]+$/);
  await page.getByRole("link", { name: "Vehicles", exact: true }).click();
  await page.getByLabel("Make", { exact: true }).fill("Ford");
  await page.getByRole("button", { name: "Add vehicle", exact: true }).click();
  await expect(page).toHaveURL(/vehicles\/[0-9a-f-]+$/);
  await page.getByRole("link", { name: "+ New RO", exact: true }).click();
  await page.getByLabel("Customer concerns / reason for visit").fill(name);
  await page.getByLabel("Assigned service advisor").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Create RO", exact: true }).click();
  await expect(page.getByLabel("Copy RO number")).toBeVisible();
  const jobUrl = page.url();

  // Give it to the staff tech.
  const team = page.locator("details.ro-team-assignment");
  if (!(await team.evaluate((el) => (el as HTMLDetailsElement).open)))
    await team.locator("summary").click();
  await team
    .getByLabel("Technician for this RO (all repairs)")
    .selectOption({ label: "Tech B" });
  // The assignment is a server action. Wait for its response before reload;
  // an immediate reload can cancel the save while the request is in flight.
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/app/jobs",
    ),
    page
      .getByRole("button", { name: "Assign technician", exact: true })
      .click(),
  ]);
  await page.reload();
  const updatedTeam = page.locator("details.ro-team-assignment");
  if (!(await updatedTeam.evaluate((el) => (el as HTMLDetailsElement).open)))
    await updatedTeam.locator("summary").click();
  await expect(
    updatedTeam
      .getByLabel("Technician for this RO (all repairs)")
      .locator("option:checked"),
  ).toHaveText("Tech B");
  // RO screens provide stage-specific controls; no unrelated floating CTA.
  await expect(page.locator("[data-ux-primary]")).toHaveCount(0);

  // The account-linked task opens the technician's assigned workspace.
  const techCtx = await browser.newContext({
    viewport: page.viewportSize() ?? undefined,
  });
  const tech = await techCtx.newPage();
  await signInWithPassword(tech, "tech.b@shop-b.test");
  await tech.goto(jobUrl);
  await expect(tech.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(tech.getByText(/Vehicle inspection/)).toBeVisible();
  await expect(
    tech.getByRole("button", {
      name: /Send estimate|Create invoice|Assign technician/,
    }),
  ).toHaveCount(0);
  await tech.goto("/app/tasks");
  await expect(tech.getByRole("heading", { name: /Tasks/i })).toBeVisible();
  await techCtx.close();

  // The owner's board, filtered to nobody, no longer shows it…
  await page.goto("/app/jobs?view=board&tech=none");
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  // …and "Everyone" shows it with the tech's name on the card.
  await page.goto("/app/jobs?view=board");
  const card = page.getByRole("link", {
    name: new RegExp(`Open job: ${name}`),
  });
  await expect(card).toBeVisible();
  await expect(card.locator(".board-tech")).not.toHaveText("");
  await auditUX(page, true);
  await page.goto(jobUrl);

  // Book a visit and put the tech on it from the schedule.
  await page.goto("/app/schedule?new=1");
  await page
    .getByLabel("Find customer", { exact: true })
    .fill(`Tech TEST ${info.project.name}`);
  await page
    .getByLabel("Customer", { exact: true })
    .selectOption({ label: `Tech TEST ${info.project.name}` });
  await page.getByLabel("Date and time").fill(chicagoTomorrow());
  await page.getByLabel("Reason").fill(`Visit ${name}`);
  await page.getByRole("button", { name: "Book visit" }).click();
  await expect(page.getByRole("status")).toContainText("Appointment booked");
  const visit = page
    .locator("article.appointment-row")
    .filter({ hasText: `Visit ${name}` });
  await visit
    .getByLabel("Who’s on this visit")
    .selectOption({ label: "Tech B" });
  await visit.getByRole("button", { name: "Save tech" }).click();
  await expect(visit).toContainText("· Tech B");
  await auditUX(page, true);
});
