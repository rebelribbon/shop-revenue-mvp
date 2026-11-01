import { writeFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.env.RUNNER_TEMP;
if (!dir) throw new Error("RUNNER_TEMP required");
const source = new URL(process.env.DATABASE_URL_BOOTSTRAP!);
source.pathname = "/" + process.env.TEST_DATABASE_NAME;
writeFileSync(
  join(dir, "m9-restore-source.env"),
  `DATABASE_URL_BOOTSTRAP=${source}\n`,
  { mode: 0o600 },
);
const keys = [
  "DATABASE_URL_BOOTSTRAP",
  "DATABASE_URL_MIGRATION",
  "DATABASE_URL_APP",
  "MIGRATION_OWNER_PASSWORD",
  "APP_USER_PASSWORD",
  "WORKER_USER_PASSWORD",
  "ADMIN_USER_PASSWORD",
];
writeFileSync(
  join(dir, "m9-restore-target.env"),
  keys.map((k) => `${k}=${process.env[k] ?? ""}`).join("\n") + "\n",
  { mode: 0o600 },
);
console.log("Disposable restore source/target configuration prepared.");
