import { readFileSync, existsSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

// Latest email to `to` received after `since`, polled from Mailpit's API.
export async function waitForEmail(to: string, since: number, match: RegExp): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages = [] } = (await res.json()) as { messages?: Array<{ ID: string; Created: string }> };
    for (const m of messages) {
      if (new Date(m.Created).getTime() < since - 2000) continue;
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text: string; HTML: string };
      const found = (full.Text + full.HTML).match(match);
      if (found) return found[0].replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no email to ${to} matching ${match}`);
}

export const signInLink = (to: string, since: number) => waitForEmail(to, since, /http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify\?[^\s"'<>]+/);
export const inviteLink = (to: string, since: number) => waitForEmail(to, since, /http:\/\/localhost:3000\/invite\/[A-Za-z0-9_-]{43}/);

// SMS codes from the fake messaging adapter's dev inbox (Section 23 "Local").
export async function waitForSmsCode(to: string, since: number): Promise<string> {
  for (let i = 0; i < 40; i++) {
    if (existsSync(".dev-inbox/messages.jsonl")) {
      const lines = readFileSync(".dev-inbox/messages.jsonl", "utf8").trim().split("\n").reverse();
      for (const l of lines) {
        const m = JSON.parse(l) as { to: string; at: string; body: string };
        if (m.to === to && new Date(m.at).getTime() >= since - 1000) {
          const code = m.body.match(/\b(\d{6})\b/);
          if (code) return code[1];
        }
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no SMS code to ${to}`);
}

export async function signInByEmail(page: Page, email: string, path = "/sign-in") {
  const since = Date.now();
  await page.goto(path);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText("If that address has access");
  await page.goto(await signInLink(email, since));
}

export async function signInBySms(page: Page, phoneE164: string, typed: string) {
  const since = Date.now();
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Use my mobile number instead" }).click();
  await page.getByLabel("Mobile number").fill(typed);
  await page.getByRole("button", { name: "Text me a code" }).click();
  await page.getByLabel("6-digit code").fill(await waitForSmsCode(phoneE164, since));
  await page.getByRole("button", { name: "Sign in" }).click();
}
