// Applies the forward-only migration chain as migration_owner (Section 24):
//   1. Graphile Worker's own schema (jobs are enqueued in our transactions)
//   2. Our Drizzle migration sequence (generated DDL + hand-written SQL)
//   3. Worker privileges on the queue schema (re-applied every run, since
//      Graphile upgrades may add objects). Graphile enables RLS with no policies
//      on its private tables because it expects to connect as their owner; our
//      worker connects as worker_user, so it needs explicit policies or it would
//      silently see an empty queue.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Logger, runMigrations } from "graphile-worker";
import pg from "pg";
import { loadEnv, requireEnv } from "../lib/env";

export async function migrateDatabase(migrationUrl: string, opts: { quiet?: boolean } = {}) {
  const pool = new pg.Pool({ connectionString: migrationUrl, max: 1 });
  pool.on("error", (err) => console.error("migration pool error", err.message));
  pool.on("connect", (client) => client.on("error", (err) => console.error("migration client error", err.message)));
  try {
    const { rows } = await pool.query("SELECT current_user AS u");
    if (rows[0].u !== "migration_owner") throw new Error(`migrations must run as migration_owner, not ${rows[0].u}`);

    await runMigrations({
      pgPool: pool,
      schema: "graphile_worker",
      logger: opts.quiet ? silentLogger : undefined,
    });
    await migrate(drizzle(pool), { migrationsFolder: "db/migrations", migrationsSchema: "drizzle" });
    await pool.query(`
      REVOKE ALL ON SCHEMA graphile_worker FROM PUBLIC;
      GRANT USAGE ON SCHEMA graphile_worker TO worker_user;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA graphile_worker TO worker_user;
      GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA graphile_worker TO worker_user;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA graphile_worker TO worker_user;
      REVOKE ALL ON SCHEMA drizzle FROM PUBLIC;
    `);
    const { rows: queueTables } = await pool.query(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'graphile_worker' AND c.relkind = 'r' AND c.relrowsecurity`);
    for (const { relname } of queueTables) {
      const table = `graphile_worker.${pg.escapeIdentifier(relname)}`;
      await pool.query(`DROP POLICY IF EXISTS worker_user_all ON ${table}`);
      await pool.query(`CREATE POLICY worker_user_all ON ${table} FOR ALL TO worker_user USING (true) WITH CHECK (true)`);
    }
  } finally {
    await pool.end();
  }
}

const silentLogger = new Logger(() => () => {});

if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnv();
  await migrateDatabase(requireEnv("DATABASE_URL_MIGRATION"));
  console.log("migrations applied");
}
