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
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  await expect(page).toHaveURL(/customers\/[0-9a-f-]+$/);
  await page.getByRole("link", { name: "Vehicles", exact: true }).click();
  await page.getByLabel("Make", { exact: true }).fill("Ford");
  await page.getByRole("button", { name: "Add vehicle", exact: true }).click();
  await expect(page).toHaveURL(/vehicles\/[0-9a-f-]+$/);
  await page.getByRole("link", { name: "+ New RO", exact: true }).click();
  await page.getByLabel("Customer concerns / reason for visit").fill(name);
  await page.getByRole("button", { name: "Create RO", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Repair order", exact: true })).toBeVisible();
  const jobUrl = page.url();

  // Give it to the staff tech.
  const pick = page.getByLabel("Tech on this job");
  await pick.selectOption({ label: "Tech B" });
  await page.getByRole("button", { name: "Save tech", exact: true }).click();
  await expect(
    page.getByLabel("Tech on this job").locator("option:checked"),
  ).toHaveText("Tech B");
  await auditUX(page, true);

  // The account-linked task opens the technician's assigned workspace.
  const techCtx = await browser.newContext({
    viewport: page.viewportSize() ?? undefined,
  });
  const tech = await techCtx.newPage();
  await signInWithPassword(tech, "tech.b@shop-b.test");
  await tech.goto(jobUrl);
  await expect(tech.getByRole("heading", { name, exact: true })).toBeVisible();
  const start = tech.getByRole("button", { name: /Start clock|Switch clock/ });
  await start.click();
  await expect(tech.getByRole("button", { name: /Stop clock/ })).toBeVisible();
  await tech.getByRole("button", { name: /Stop clock/ }).click();
  await expect(tech.getByRole("button", { name: /Start clock/ })).toBeVisible();
  await auditUX(tech, true);
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
