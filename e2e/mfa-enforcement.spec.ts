import { test, expect } from "@playwright/test";
import { E2E_PASSWORD } from "./helpers";
import { auditUX } from "./ux-audit";
import { totp } from "./totp";

test.describe("mandatory authenticator @mfa", () => {
  test.skip(
    process.env.E2E_MFA !== "true",
    "Uses the dedicated MFA-enforced server",
  );
  for (const account of [
    { role: "owner", email: "owner.a@shop-a.test", internal: false },
    { role: "staff", email: "staff.a@shop-a.test", internal: false },
    { role: "technician", email: "tech.b@shop-b.test", internal: false },
    { role: "admin", email: "admin.one@example.test", internal: true },
    { role: "support", email: "support.one@example.test", internal: true },
  ]) {
    test(`${account.role} cannot open records until an actual authenticator code is verified`, async ({
      page,
    }) => {
      const signIn = async () => {
        await page.goto(account.internal ? "/admin/sign-in" : "/sign-in");
        await page.getByLabel("Email").fill(account.email);
        await page.getByLabel("Password").fill(E2E_PASSWORD);
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await expect(page).toHaveURL(/\/verify\?next=/);
      };
      await signIn();
      const home = account.internal ? "/admin" : "/app";
      await page.goto(home);
      await expect(page).toHaveURL(/\/verify\?next=/);
      if (!account.internal) {
        for (const path of [
          "/app/documents/11111111-1111-4111-8111-111111111111/pdf",
          "/media/11111111-1111-4111-8111-111111111111",
          "/app/settings/export/customers",
        ])
          expect((await page.request.get(path)).status()).toBe(403);
      }
      await page
        .getByRole("button", { name: "Set up authenticator", exact: true })
        .click();
      await expect(
        page.getByAltText("Authenticator enrollment QR code"),
      ).toBeVisible();
      await page.getByText("Enter setup key manually", { exact: true }).click();
      const secret = (await page.locator("code").textContent())!;
      await page.getByLabel("Authenticator code").fill(totp(secret));
      await page
        .getByRole("button", { name: "Verify authenticator", exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`${home}$`));
      await page.request.post("/auth/sign-out");
      await signIn();
      await expect(page.getByLabel("Authenticator code")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Set up authenticator", exact: true }),
      ).toHaveCount(0);
      await auditUX(page);
      // Enrollment secrets have been removed; this screenshot contains only the challenge form.
      await page.screenshot({
        path: `test-results/hardening-mfa-${account.role}.png`,
        fullPage: true,
      });
    });
  }
});
