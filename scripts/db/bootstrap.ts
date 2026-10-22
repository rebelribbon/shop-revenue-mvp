// Role bootstrap (Section 9). Run by a privileged connection (local: postgres;
// CI: the service superuser; hosted: the project's postgres role) before the
// first migration, and again whenever role passwords rotate. Idempotent.
//
//   migration_owner  owns every table and function; the only role that runs DDL
//   app_user         web app; no BYPASSRLS, no superuser, owns nothing
//   worker_user      Graphile Worker process; subject to tenant RLS
//   admin_user       /admin internal console; subject to tenant RLS
import pg from "pg";
import { loadEnv, requireEnv } from "../lib/env";

export const RUNTIME_ROLES = ["app_user", "worker_user", "admin_user"] as const;

export async function bootstrapRoles(opts: {
  bootstrapUrl: string;
  databaseName: string;
  passwords: Record<"migration_owner" | (typeof RUNTIME_ROLES)[number], string>;
}) {
  const client = new pg.Client({ connectionString: opts.bootstrapUrl });
  await client.connect();
  const lit = (v: string) => client.escapeLiteral(v);
  const id = (v: string) => client.escapeIdentifier(v);
  try {
    for (const role of ["migration_owner", ...RUNTIME_ROLES]) {
      const { rowCount } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
      // CREATE ROLE defaults are NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE. Hosted
      // Supabase's postgres role is not a superuser and may not name those attributes,
      // so they are verified below instead of being restated here.
      if (!rowCount) await client.query(`CREATE ROLE ${id(role)} LOGIN`);
      // NOINHERIT on runtime roles: privileges are never picked up through role membership.
      const inherit = role === "migration_owner" ? "INHERIT" : "NOINHERIT";
      await client.query(
        `ALTER ROLE ${id(role)} LOGIN ${inherit} PASSWORD ${lit(opts.passwords[role as keyof typeof opts.passwords])}`,
      );
    }
    const { rows: unsafe } = await client.query(
      `SELECT rolname FROM pg_roles
        WHERE rolname = ANY($1) AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)`,
      [["migration_owner", ...RUNTIME_ROLES]],
    );
    if (unsafe.length) {
      throw new Error(`roles have unsafe attributes (superuser/bypassrls/createdb/createrole/replication): ${unsafe
        .map((r) => r.rolname)
        .join(", ")}`);
    }
    // Runtime roles must never be able to act as the owner.
    for (const role of RUNTIME_ROLES) {
      const { rows } = await client.query("SELECT pg_has_role($1, 'migration_owner', 'MEMBER') AS m", [role]);
      if (rows[0].m) await client.query(`REVOKE migration_owner FROM ${id(role)}`);
    }
    const db = id(opts.databaseName);
    await client.query(`GRANT CONNECT, CREATE, TEMPORARY ON DATABASE ${db} TO migration_owner`);
    await client.query(`GRANT CONNECT ON DATABASE ${db} TO app_user, worker_user, admin_user`);
    // Nothing of ours lives in public; nobody may create objects there.
    await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    // Default privileges (no EXECUTE for PUBLIC) are set by migration 0000, running as
    // migration_owner itself; hosted Supabase's postgres role may not set them for another role.
    // Section 24 production safety.
    await client.query("ALTER ROLE migration_owner SET lock_timeout = '5s'");
    await client.query("ALTER ROLE migration_owner SET statement_timeout = '60s'");
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnv();
  const bootstrapUrl = requireEnv("DATABASE_URL_BOOTSTRAP");
  await bootstrapRoles({
    bootstrapUrl,
    databaseName: new URL(bootstrapUrl).pathname.slice(1) || "postgres",
    passwords: {
      migration_owner: requireEnv("MIGRATION_OWNER_PASSWORD"),
      app_user: requireEnv("APP_USER_PASSWORD"),
      worker_user: requireEnv("WORKER_USER_PASSWORD"),
      admin_user: requireEnv("ADMIN_USER_PASSWORD"),
    },
  });
  console.log("roles bootstrapped");
}
