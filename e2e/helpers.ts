import { auditUX } from "./ux-audit";
import { expect, type Page } from "@playwright/test";

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
export const E2E_PASSWORD =
  process.env.E2E_TEST_PASSWORD ?? "ShopRevenueLocal123!";

export async function waitForEmail(
  to: string,
  since: number,
  match: RegExp,
): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    );
    const { messages = [] } = (await res.json()) as {
      messages?: Array<{ ID: string; Created: string }>;
    };
    for (const m of messages) {
      if (new Date(m.Created).getTime() < since - 2000) continue;
      const full = (await (
        await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)
      ).json()) as { Text: string; HTML: string };
      const found = (full.Text + full.HTML).match(match);
      if (found) return found[0].replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no email to ${to} matching ${match}`);
}

export const recoveryLink = (to: string, since: number) =>
  waitForEmail(
    to,
    since,
    /http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify\?[^\s"'<>]+/,
  );
export const inviteLink = (to: string, since: number) =>
  waitForEmail(to, since, /http:\/\/localhost:3000\/invite\/[A-Za-z0-9_-]{43}/);

export async function signInWithPassword(
  page: Page,
  email: string,
  path = "/sign-in",
  password = E2E_PASSWORD,
) {
  await page.goto(path);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Server actions set the session cookie before redirecting. Do not let the
  // caller navigate away while that response is still in flight.
  await expect(page).toHaveURL(
    path === "/admin/sign-in" ? /\/admin$/ : /\/app(?:\/tasks)?$/,
  );
}

export async function setInvitePassword(
  page: Page,
  email: string,
  since: number,
  password = E2E_PASSWORD,
) {
  await page.goto(await recoveryLink(email, since));
  await expect(page.getByRole("heading", { name: /password/i })).toBeVisible();
  await auditUX(page);
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();
}

export async function drawEstimateSignature(page: Page) {
  await page
    .getByRole("img", { name: "Drawn signature", exact: true })
    .scrollIntoViewIfNeeded();
  const bounds = await page
    .getByRole("img", { name: "Drawn signature", exact: true })
    .boundingBox();
  if (!bounds) throw new Error("Signature pad unavailable");
  await page.mouse.move(bounds.x + 20, bounds.y + 30);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 90, bounds.y + 80, { steps: 8 });
  await page.mouse.move(bounds.x + 180, bounds.y + 40, { steps: 8 });
  await page.mouse.up();
}

export async function revealField(page: Page, label: string) {
  const field = page.getByLabel(label, { exact: true });
  const details = field.locator("xpath=ancestor::details");
  for (const parent of await details.all()) {
    if (!(await parent.evaluate((e) => e.hasAttribute("open"))))
      await parent.locator(":scope > summary").click();
  }
}

// The customer estimate: when it has an inspection or recommended work it is
// stepped (request, inspection, recommendations, sign). Approves every item on
// each step and stops on the signing step.
export async function approveEstimateSteps(page: Page) {
  for (let i = 0; i < 6; i++) {
    for (const radio of await page
      .getByRole("radio", { name: /^Approve / })
      .all())
      await radio.check();
    const next = page.getByRole("button", { name: /^Next: / });
    if (!(await next.count())) return;
    await next.click();
  }
}
