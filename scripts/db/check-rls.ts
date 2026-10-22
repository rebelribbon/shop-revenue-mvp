// CI RLS presence check (Sections 9 and 22): fails the build if any table with a
// business_id column lacks RLS enabled + forced + at least one permissive policy.
// Also requires every table in the app schema to have RLS enabled and forced,
// tenant or global, so nothing is ever readable by default.
import pg from "pg";
import { loadEnv, requireEnv } from "../lib/env";

export type RlsViolation = { table: string; problems: string[] };

export async function findRlsViolations(client: pg.ClientBase): Promise<RlsViolation[]> {
  const { rows } = await client.query(`
    SELECT n.nspname || '.' || c.relname AS table,
           c.relrowsecurity AS enabled,
           c.relforcerowsecurity AS forced,
           EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = 'business_id' AND NOT a.attisdropped) AS has_business_id,
           (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid AND p.polpermissive)::int AS permissive_policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p')
       AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'graphile_worker', 'drizzle')
       AND n.nspname NOT LIKE 'pg_toast%'
       -- Supabase-managed schemas are not ours to check
       AND n.nspname NOT IN ('auth', 'storage', 'realtime', 'extensions', 'supabase_functions', 'supabase_migrations',
                             'vault', 'pgsodium', 'net', 'cron', 'graphql', 'graphql_public', '_realtime', 'pgbouncer')
       AND (n.nspname = 'app' OR EXISTS (SELECT 1 FROM pg_attribute a
                                          WHERE a.attrelid = c.oid AND a.attname = 'business_id' AND NOT a.attisdropped))
     ORDER BY 1`);
  return rows
    .map((r) => {
      const problems: string[] = [];
      if (!r.enabled) problems.push("RLS not enabled");
      if (!r.forced) problems.push("RLS not forced");
      if (r.has_business_id && r.permissive_policies === 0) problems.push("no permissive policy");
      return { table: r.table as string, problems };
    })
    .filter((v) => v.problems.length > 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnv();
  const client = new pg.Client({ connectionString: requireEnv("DATABASE_URL_MIGRATION") });
  await client.connect();
  try {
    const violations = await findRlsViolations(client);
    if (violations.length) {
      for (const v of violations) console.error(`RLS check FAILED: ${v.table}: ${v.problems.join(", ")}`);
      process.exitCode = 1;
    } else {
      console.log("RLS check passed: every business_id table has RLS enabled, forced and a policy");
    }
  } finally {
    await client.end();
  }
}
