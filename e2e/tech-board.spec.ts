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

test("Put a tech on a job; it shows on their day and the board", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const name = `Tech ${info.project.name} ${Date.now()}`;
  await signInWithPassword(page, "owner.a@shop-a.test");
  await page.goto("/app/customers/new");
  await page.getByLabel("First name").fill("Tech");
  await page.getByLabel("Last name").fill(`TEST ${info.project.name}`);
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  await expect(page).toHaveURL(/customers\/[0-9a-f-]+$/);
  await page.getByRole("link", { name: "Vehicles", exact: true }).click();
  await page.getByLabel("Make", { exact: true }).fill("Ford");
  await page.getByRole("button", { name: "Add vehicle", exact: true }).click();
  await expect(page).toHaveURL(/vehicles\/[0-9a-f-]+$/);
  await page.getByRole("link", { name: "New job", exact: true }).click();
  await page.getByLabel("Job name").fill(name);
  await page.getByRole("button", { name: "Add labor", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).fill("Diagnose");
  await page.getByLabel("Quoted hours", { exact: true }).fill("1");
  await page.getByLabel("Hourly selling rate", { exact: true }).fill("100");
  await page
    .getByRole("button", { name: "Save job sheet", exact: true })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const jobUrl = page.url();

  // Give it to the staff tech.
  const pick = page.getByLabel("Tech on this job");
  await pick.selectOption({ label: "Staff A" });
  await page.getByRole("button", { name: "Save tech", exact: true }).click();
  await expect(
    page.getByLabel("Tech on this job").locator("option:checked"),
  ).toHaveText("Staff A");
  await auditUX(page, true);

  // The tech signs in on their phone: it's on their day.
  const techCtx = await browser.newContext({
    viewport: page.viewportSize() ?? undefined,
  });
  const tech = await techCtx.newPage();
  await signInWithPassword(tech, "staff.a@shop-a.test");
  await expect(
    tech.getByRole("link", { name: /^My day: \d+ job/ }),
  ).toBeVisible();
  await tech.goto("/app/my-day");
  const mine = tech.getByRole("region", { name: "Your jobs" });
  await expect(mine.getByText(name, { exact: true })).toBeVisible();
  await auditUX(tech, true);
  // Clock on and off from My day.
  const start = tech.getByRole("button", { name: `▶ Start: ${name}` });
  if (await start.isVisible()) await start.click();
  else
    await mine
      .getByRole("listitem")
      .filter({ hasText: name })
      .getByRole("button", { name: /Start clock|Switch clock/ })
      .click();
  await expect(tech.getByText("Clock running on")).toBeVisible();
  await auditUX(tech, true);
  await tech.getByRole("button", { name: "■ Stop clock" }).click();
  await expect(tech.getByText("Clock running on")).toHaveCount(0);
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
    .getByLabel("Customer", { exact: true })
    .selectOption({ label: `Tech TEST ${info.project.name}` });
  await page.getByLabel("Date and time").fill(chicagoTomorrow());
  await page.getByLabel("Reason").fill(`Visit ${name}`);
  await page.getByRole("button", { name: "Book visit" }).click();
  await expect(page.getByRole("status")).toContainText("Visit booked");
  const visit = page
    .locator("article.appointment-row")
    .filter({ hasText: `Visit ${name}` });
  await visit
    .getByLabel("Who’s on this visit")
    .selectOption({ label: "Staff A" });
  await visit.getByRole("button", { name: "Save tech" }).click();
  await expect(visit).toContainText("· Staff A");
  await auditUX(page, true);
});
