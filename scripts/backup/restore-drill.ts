// Restore drill (Section 27 "one full restore drill documented with time to
// restore"; M1 acceptance "one backup restored successfully into a scratch
// project"). Dumps the source database, restores it into a fresh scratch
// database, and verifies it: per-table row counts equal the source, RLS is
// still enabled + forced with policies, grants survive (app_user outside a
// tenant context sees nothing), and the migration journal matches.
//
//   SOURCE_ENV=.env.dev-hosted TARGET_ENV=.env.local pnpm exec tsx scripts/backup/restore-drill.ts [--keep]
//
// Until the hosted restore-scratch project exists, the target is a scratch
// database on the local Supabase stack. Secrets go to Docker as environment
// passthrough (-e NAME), never on a command line or in output.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import pg from "pg";
import { bootstrapRoles } from "../db/bootstrap";
import { findRlsViolations } from "../db/check-rls";

const PG_IMAGE = process.env.PG_TOOLS_IMAGE ?? "public.ecr.aws/supabase/postgres:17.11.0.004";
const SCHEMAS = ["app", "graphile_worker", "drizzle"];
const keep = process.argv.includes("--keep");

const readEnv = (file: string) => parseEnv(readFileSync(file, "utf8")) as Record<string, string>;
const source = readEnv(process.env.SOURCE_ENV ?? ".env.dev-hosted");
const target = readEnv(process.env.TARGET_ENV ?? ".env.local");
const sourceUrl = source.DATABASE_URL_BOOTSTRAP; // backup role: must bypass RLS (Supabase postgres does)
const targetAdminUrl = target.DATABASE_URL_BOOTSTRAP;
const name = `restore_drill_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
const withDb = (url: string, db: string) => Object.assign(new URL(url), { pathname: `/${db}` }).toString();
const targetUrl = withDb(targetAdminUrl, name);

// libpq (pg_dump/pg_restore) rejects node-postgres-only URL options.
const libpq = (url: string) => {
  const u = new URL(url);
  u.searchParams.delete("uselibpqcompat");
  return u.toString();
};

function docker(args: string[], env: Record<string, string>) {
  const r = spawnSync("docker", ["run", "--rm", "--network", "host", ...Object.keys(env).flatMap((k) => ["-e", k]), ...args], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`docker ${args[args.length - 1].slice(0, 40)}… failed: ${(r.stderr || "").replace(/postgres(ql)?:\/\/[^\s"]+/g, "[url]").slice(0, 500)}`);
  return r.stdout;
}

async function counts(url: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const { rows } = await c.query(
      `SELECT n.nspname || '.' || c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = ANY($1) ORDER BY 1`,
      [SCHEMAS],
    );
    const out: Record<string, number> = {};
    for (const { t } of rows) {
      const [s, r] = t.split(".");
      out[t] = Number((await c.query(`SELECT count(*) AS n FROM ${c.escapeIdentifier(s)}.${c.escapeIdentifier(r)}`)).rows[0].n);
    }
    return out;
  } finally {
    await c.end();
  }
}

const dir = mkdtempSync(join(tmpdir(), "restore-drill-"));
const timings: Record<string, number> = {};
let t = Date.now();
const lap = (k: string) => {
  timings[k] = Date.now() - t;
  t = Date.now();
};
try {
  // 1. Backup: custom-format dump of our schemas (what the nightly job ships off-site).
  docker(["-v", `${dir}:/out`, PG_IMAGE, "sh", "-c", `pg_dump "$PGSRC" -Fc ${SCHEMAS.map((s) => `-n ${s}`).join(" ")} -f /out/backup.pgc`], { PGSRC: libpq(sourceUrl) });
  const dump = readFileSync(join(dir, "backup.pgc"));
  const sha256 = createHash("sha256").update(dump).digest("hex");
  const sourceCounts = await counts(sourceUrl);
  lap("dumpMs");

  // 2. Restore into a fresh scratch database with the production roles.
  const admin = new pg.Client({ connectionString: targetAdminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(name)}`);
  await admin.end();
  await bootstrapRoles({
    bootstrapUrl: targetUrl,
    databaseName: name,
    passwords: {
      migration_owner: target.MIGRATION_OWNER_PASSWORD,
      app_user: target.APP_USER_PASSWORD,
      worker_user: target.WORKER_USER_PASSWORD,
      admin_user: target.ADMIN_USER_PASSWORD,
    },
  });
  // Restore as migration_owner, the role that owns every object in production;
  // pg_dump places RLS enablement, policies and triggers after the data.
  docker(["-v", `${dir}:/out`, PG_IMAGE, "sh", "-c", 'pg_restore --exit-on-error -d "$PGDST" /out/backup.pgc'], {
    PGDST: libpq(withDb(target.DATABASE_URL_MIGRATION, name)),
  });
  lap("restoreMs");

  // 3. Verify.
  const restoredCounts = await counts(targetUrl);
  const mismatched = Object.keys({ ...sourceCounts, ...restoredCounts }).filter((k) => sourceCounts[k] !== restoredCounts[k]);
  const mo = new pg.Client({ connectionString: withDb(target.DATABASE_URL_MIGRATION, name) });
  await mo.connect();
  const rlsViolations = await findRlsViolations(mo);
  const journal = Number((await mo.query("SELECT count(*) n FROM drizzle.__drizzle_migrations")).rows[0].n);
  await mo.end();
  const app = new pg.Client({ connectionString: withDb(target.DATABASE_URL_APP, name) });
  await app.connect();
  const visibleWithoutTenant = Number((await app.query("SELECT count(*) n FROM app.business")).rows[0].n);
  await app.end();
  lap("verifyMs");

  const ok = mismatched.length === 0 && rlsViolations.length === 0 && visibleWithoutTenant === 0 && journal > 0;
  console.log(
    JSON.stringify(
      {
        ok,
        source: new URL(sourceUrl).hostname,
        target: `${new URL(targetAdminUrl).hostname}/${name}`,
        dump: { bytes: statSync(join(dir, "backup.pgc")).size, sha256 },
        tables: Object.keys(sourceCounts).length,
        rows: Object.values(sourceCounts).reduce((a, b) => a + b, 0),
        mismatched,
        rlsViolations,
        migrationsApplied: journal,
        appUserRowsWithoutTenant: visibleWithoutTenant,
        timings,
        timeToRestoreMs: timings.restoreMs + timings.verifyMs,
      },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
  if (!keep) {
    const admin = new pg.Client({ connectionString: targetAdminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${admin.escapeIdentifier(name)} WITH (FORCE)`);
    await admin.end();
  }
}
