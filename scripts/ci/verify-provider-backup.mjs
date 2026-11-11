import { pathToFileURL } from "node:url";
import { managementRead, projects } from "./launch-config-audit.mjs";

export async function verifyProductionBackup(
  env = process.env,
  fetcher = fetch,
) {
  if (env.SUPABASE_PROJECT_REF !== projects.production)
    throw new Error("Unexpected production backup project");
  const result = await managementRead(
    "production",
    "database/backups",
    env.SUPABASE_ACCESS_TOKEN,
    fetcher,
  );
  if (!result.ok)
    throw new Error(
      `Provider backup lookup failed: ${result.reason} (${result.httpStatus ?? "no response"})`,
    );
  if (!result.summary.recentDailyBackup && !result.summary.recentRestorePoint)
    throw new Error(
      "No completed daily backup within 26 hours or PITR restore point within 24 hours; production migration blocked",
    );
  return { providerBackupVerified: true, ...result.summary };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(JSON.stringify(await verifyProductionBackup(), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
