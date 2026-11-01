// Read-only setup inspection. Never serialize provider responses or credentials.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
export const projects = {
  staging: "gcclcuvdrqqllolxqhok",
  production: "akwxgjxdhfylebsteyqi",
};
const flag = (v) => (typeof v === "boolean" ? v : null);
export function authSummary(data) {
  return {
    customSmtpConfigured: !!(
      data.smtp_host &&
      data.smtp_user &&
      data.smtp_admin_email
    ),
    totpEnrollment: flag(data.mfa_totp_enroll_enabled),
    totpVerification: flag(data.mfa_totp_verify_enabled),
    leakedPasswordProtection: flag(data.password_hibp_enabled),
    googleSignIn: flag(data.external_google_enabled),
    publicSignupDisabled: flag(data.disable_signup),
  };
}
export function backupSummary(data, now = Date.now()) {
  const dates = (data.backups ?? [])
    .filter((b) => b.status === "COMPLETED")
    .map((b) => Date.parse(b.inserted_at))
    .filter((n) => Number.isFinite(n) && n <= now);
  const latest = dates.length ? Math.max(...dates) : null;
  const earliest = Number(
    data.physical_backup_data?.earliest_physical_backup_date_unix,
  );
  const last = Number(
    data.physical_backup_data?.latest_physical_backup_date_unix,
  );
  return {
    pitrEnabled: data.pitr_enabled === true,
    pitrHistoryAtLeastSevenDays:
      data.pitr_enabled === true &&
      earliest > 0 &&
      last >= earliest &&
      last <= now / 1000 &&
      last - earliest >= 7 * 86400,
    recentRestorePoint:
      data.pitr_enabled === true &&
      last > 0 &&
      last <= now / 1000 &&
      now - last * 1000 <= 86400000,
    recentDailyBackup: latest !== null && now - latest <= 26 * 3600000,
    latestDailyBackupAt:
      latest === null ? null : new Date(latest).toISOString(),
  };
}
export async function managementRead(
  environment,
  path,
  token,
  fetcher = fetch,
) {
  if (
    !Object.hasOwn(projects, environment) ||
    !["config/auth", "database/backups"].includes(path)
  )
    throw new Error("Unsupported inspection target");
  if (!token)
    return { ok: false, httpStatus: null, reason: "MANAGEMENT_TOKEN_MISSING" };
  try {
    const response = await fetcher(
      "https://api.supabase.com/v1/projects/" +
        projects[environment] +
        "/" +
        path,
      {
        headers: { Authorization: "Bearer " + token },
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok)
      return {
        ok: false,
        httpStatus: response.status,
        reason: "MANAGEMENT_READ_DENIED",
      };
    const data = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data))
      return {
        ok: false,
        httpStatus: response.status,
        reason: "UNEXPECTED_PROVIDER_RESPONSE",
      };
    return {
      ok: true,
      httpStatus: response.status,
      summary: path === "config/auth" ? authSummary(data) : backupSummary(data),
    };
  } catch {
    return { ok: false, httpStatus: null, reason: "MANAGEMENT_READ_FAILED" };
  }
}
export async function inspectSetup(
  environment,
  env = process.env,
  fetcher = fetch,
) {
  if (!Object.hasOwn(projects, environment))
    throw new Error("Unsupported inspection target");
  const [auth, backups] = await Promise.all(
    ["config/auth", "database/backups"].map((path) =>
      managementRead(environment, path, env.SUPABASE_ACCESS_TOKEN, fetcher),
    ),
  );
  const indicators = [
    "BACKUP_DATABASE_URL",
    "BACKUP_S3_BUCKET",
    "BACKUP_AWS_REGION",
    "BACKUP_AWS_ROLE_ARN",
    "BACKUP_KMS_KEY_ARN",
    "BACKUP_AGE_RECIPIENT",
    "BACKUP_AGE_IDENTITY",
    "STORAGE_S3_ENDPOINT",
    "STORAGE_S3_ACCESS_KEY_ID",
    "STORAGE_S3_SECRET_ACCESS_KEY",
  ];
  return {
    environment,
    project: projects[environment],
    inspectedAt: new Date().toISOString(),
    commit: env.GITHUB_SHA ?? null,
    auditCompleted: auth.ok && backups.ok,
    launchReady: false,
    auth,
    backups,
    repositoryBackupConfiguration: Object.fromEntries(
      indicators.map((key) => [key, env["HAS_" + key] === "true"]),
    ),
    limitations: [
      "Configuration inspection is not delivered email, MFA recovery, off-site restore, alert delivery, independent review or release approval.",
      "Vercel runtime configuration must be checked separately.",
    ],
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const report = await inspectSetup(process.env.SETUP_ENVIRONMENT);
  const json = JSON.stringify(report, null, 2);
  if (process.env.RUNNER_TEMP)
    writeFileSync(
      join(
        process.env.RUNNER_TEMP,
        "launch-setup-" + report.environment + ".json",
      ),
      json,
    );
  console.log(json);
  if (!report.auditCompleted) process.exitCode = 1;
}
