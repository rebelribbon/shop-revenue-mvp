// CI self-test (M1 acceptance: "CI fails a migration that adds a tenant table
// without RLS"). Builds a throwaway database with the full chain, applies a
// fixture migration that forgets RLS, and requires the RLS check to fail on it.
import { readFileSync } from "node:fs";
import pg from "pg";
import { bootstrapRoles } from "../db/bootstrap";
import { findRlsViolations } from "../db/check-rls";
import { migrateDatabase } from "../db/migrate";
import { loadEnv, requireEnv } from "../lib/env";

loadEnv();
const name = `rls_selftest_${Date.now()}`;
const bootstrap = requireEnv("DATABASE_URL_BOOTSTRAP");
const withDb = (url: string) => Object.assign(new URL(url), { pathname: `/${name}` }).toString();
const root = new pg.Client({ connectionString: bootstrap });
await root.connect();
await root.query(`CREATE DATABASE "${name}"`);
try {
  await bootstrapRoles({
    bootstrapUrl: withDb(bootstrap),
    databaseName: name,
    passwords: {
      migration_owner: requireEnv("MIGRATION_OWNER_PASSWORD"),
      app_user: requireEnv("APP_USER_PASSWORD"),
      worker_user: requireEnv("WORKER_USER_PASSWORD"),
      admin_user: requireEnv("ADMIN_USER_PASSWORD"),
    },
  });
  await migrateDatabase(withDb(requireEnv("DATABASE_URL_MIGRATION")), { quiet: true });
  const c = new pg.Client({ connectionString: withDb(requireEnv("DATABASE_URL_MIGRATION")) });
  await c.connect();
  if ((await findRlsViolations(c)).length) throw new Error("self-test setup: clean chain already has violations");
  await c.query(readFileSync("tests/fixtures/migration-without-rls.sql", "utf8"));
  const violations = await findRlsViolations(c);
  await c.end();
  const caught = violations.find((v) => v.table === "app.forgot_rls");
  if (!caught) throw new Error("RLS check did NOT catch a tenant table added without RLS");
  console.log(`RLS check self-test passed: rejected app.forgot_rls (${caught.problems.join(", ")})`);
} finally {
  await root.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await root.end();
}
