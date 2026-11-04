import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authSummary,
  backupSummary,
  managementRead,
  inspectSetup,
} from "../../scripts/ci/launch-config-audit.mjs";
test("auth output omits SMTP passwords and OAuth credentials", () => {
  const data = {
    smtp_host: "fixture-host",
    smtp_user: "fixture-user",
    smtp_admin_email: "fixture@example.test",
    smtp_pass: "fixture-password-only",
    external_google_secret: "fixture-google-only",
    external_google_enabled: true,
    mfa_totp_enroll_enabled: true,
    mfa_totp_verify_enabled: false,
    password_hibp_enabled: false,
  };
  const result = authSummary(data);
  assert.equal(result.customSmtpConfigured, true);
  assert.equal(result.totpVerification, false);
  assert.equal(result.leakedPasswordProtection, false);
  assert.doesNotMatch(
    JSON.stringify(result),
    /fixture|smtp_pass|google_secret/,
  );
  assert.equal(authSummary({}).totpEnrollment, null);
});
test("backup inspection rejects future and invalid restore points", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  for (const inserted_at of ["bad-date", "2026-10-30T12:00:00Z"])
    assert.equal(
      backupSummary({ backups: [{ status: "COMPLETED", inserted_at }] }, now)
        .recentDailyBackup,
      false,
    );
  const result = backupSummary(
    {
      pitr_enabled: true,
      physical_backup_data: {
        earliest_physical_backup_date_unix: now / 1000 - 8 * 86400,
        latest_physical_backup_date_unix: now / 1000 - 60,
      },
    },
    now,
  );
  assert.equal(result.pitrHistoryAtLeastSevenDays, true);
  assert.equal(result.recentRestorePoint, true);
  assert.equal(
    backupSummary(
      {
        pitr_enabled: true,
        physical_backup_data: {
          earliest_physical_backup_date_unix: now / 1000,
          latest_physical_backup_date_unix: now / 1000 + 3600,
        },
      },
      now,
    ).recentRestorePoint,
    false,
  );
});
test("missing credentials do not issue network calls", async () => {
  const result = await managementRead("production", "config/auth", "", () => {
    throw new Error("must not call");
  });
  assert.equal(result.reason, "MANAGEMENT_TOKEN_MISSING");
});
test("inspection fixes target and forbids redirect credential forwarding", async () => {
  const result = await managementRead(
    "production",
    "config/auth",
    "fixture-token",
    async (url, options) => {
      assert.equal(
        url,
        "https://api.supabase.com/v1/projects/akwxgjxdhfylebsteyqi/config/auth",
      );
      assert.equal(options.redirect, "error");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          smtp_pass: "fixture-secret",
          mfa_totp_verify_enabled: true,
        }),
      };
    },
  );
  assert.equal(result.summary.totpVerification, true);
  assert.doesNotMatch(JSON.stringify(result), /fixture/);
  await assert.rejects(() => managementRead("outside", "config/auth", "x"));
  await assert.rejects(() => managementRead("production", "secrets", "x"));
});
test("provider failures never echo response bodies or exception diagnostics", async () => {
  const denied = await managementRead(
    "staging",
    "config/auth",
    "fixture-token",
    async () => ({
      ok: false,
      status: 403,
      text: async () => "fixture-secret",
    }),
  );
  assert.equal(denied.httpStatus, 403);
  const failed = await managementRead(
    "staging",
    "config/auth",
    "fixture-token",
    async () => {
      throw new Error("fixture-password");
    },
  );
  assert.equal(failed.reason, "MANAGEMENT_READ_FAILED");
  assert.doesNotMatch(JSON.stringify([denied, failed]), /fixture/);
});
test("inspection always distinguishes configured resources from launch approval", async () => {
  const report = await inspectSetup(
    "staging",
    { SUPABASE_ACCESS_TOKEN: "fixture-token", HAS_BACKUP_DATABASE_URL: "true" },
    async () => ({ ok: true, status: 200, json: async () => ({}) }),
  );
  assert.equal(report.auditCompleted, true);
  assert.equal(report.launchReady, false);
  assert.equal(report.repositoryBackupConfiguration.BACKUP_DATABASE_URL, true);
  assert.equal(report.repositoryBackupConfiguration.BACKUP_AGE_IDENTITY, false);
  assert.doesNotMatch(JSON.stringify(report), /fixture-token/);
});
