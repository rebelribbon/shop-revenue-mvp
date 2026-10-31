// Restore drill (Section 27 "one full restore drill documented with time to
// restore"; M1 acceptance "one backup restored successfully into a scratch
// project"). Dumps the source database, restores it into a fresh scratch
// database, and verifies it against the source:
//   - per-table row counts equal the source
//   - migration journal equals the source and the repo's journal
//   - RLS enabled + forced on every tenant table; RLS flags and policies identical to the source
//   - grants (table, sequence, schema, function ACLs) identical to the source
//   - app_user outside a tenant context sees zero rows in every tenant table
//   - app_user inside one business's context sees no other business's rows
//
// SOURCE_ENV=.env.dev-hosted TARGET_ENV=.env.local pnpm exec tsx scripts/backup/restore-drill.ts [--keep]
//
// In CI (.github/workflows/restore-drill.yml) the source is production through a
// temporary read-only login role and the target is a disposable Postgres on the
// runner. Secrets go to Docker as environment passthrough (-e NAME), never on a
// command line or in output. DRILL_RESULT_FILE, when set, also receives the
// non-secret JSON result.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import pg from "pg";
import { bootstrapRoles } from "../db/bootstrap";
import { findRlsViolations } from "../db/check-rls";

const PG_IMAGE =
  process.env.PG_TOOLS_IMAGE ?? "public.ecr.aws/supabase/postgres:17.11.0.004";
const SCHEMAS = ["app", "graphile_worker", "drizzle"];
const TENANT_GUC = "app.business_id";
const keep = process.argv.includes("--keep");

const readEnv = (file: string) =>
  parseEnv(readFileSync(file, "utf8")) as Record<string, string>;
const source = readEnv(process.env.SOURCE_ENV ?? ".env.dev-hosted");
const target = readEnv(process.env.TARGET_ENV ?? ".env.local");
const sourceUrl = source.DATABASE_URL_BOOTSTRAP; // backup role: must bypass RLS
const targetAdminUrl = target.DATABASE_URL_BOOTSTRAP;
const name = `restore_drill_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
const withDb = (url: string, db: string) =>
  Object.assign(new URL(url), { pathname: `/${db}` }).toString();
const targetUrl = withDb(targetAdminUrl, name);

// libpq (pg_dump/pg_restore) rejects node-postgres-only URL options.
const libpq = (url: string) => {
  const u = new URL(url);
  u.searchParams.delete("uselibpqcompat");
  return u.toString();
};

function docker(args: string[], env: Record<string, string>) {
  const r = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      "host",
      ...Object.keys(env).flatMap((k) => ["-e", k]),
      ...args,
    ],
    {
      env: { ...process.env, ...env },
      encoding: "utf8",
    },
  );
  if (r.status !== 0)
    throw new Error(
      `docker ${args[args.length - 1].slice(0, 40)}… failed: ${(r.stderr || "").replace(/postgres(ql)?:\/\/[^\s"]+/g, "[url]").slice(0, 500)}`,
    );
  return r.stdout;
}

async function withClient<T>(
  url: string,
  fn: (c: pg.Client) => Promise<T>,
): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function counts(url: string) {
  return withClient(url, async (c) => {
    const { rows } = await c.query(
      `SELECT n.nspname || '.' || c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'r' AND n.nspname = ANY($1) ORDER BY 1`,
      [SCHEMAS],
    );
    const out: Record<string, number> = {};
    for (const { t } of rows) {
      const [s, r] = String(t).split(".");
      out[t] = Number(
        (
          await c.query(
            `SELECT count(*) AS n FROM ${c.escapeIdentifier(s)}.${c.escapeIdentifier(r)}`,
          )
        ).rows[0].n,
      );
    }
    return out;
  });
}

// Security state that must survive a restore exactly: owner and effective ACL
// of schemas, relations and functions (grantee=privileges; grantor ignored);
// RLS flags; policy definitions; migration journal.
async function securitySnapshot(url: string) {
  return withClient(url, async (c) => {
    // Effective ACL: a NULL acl means the built-in default (acldefault), which
    // pg_dump does not re-emit, so compare COALESCE(acl, acldefault(...)).
    // Owner is part of the value: who owns an object is security state too.
    const acl = await c.query(
      `SELECT 'schema ' || n.nspname AS k,
              pg_get_userbyid(n.nspowner) || ' ' || array_to_string(ARRAY(
                SELECT regexp_replace(unnest(COALESCE(n.nspacl, acldefault('n', n.nspowner)))::text, '/[^/]*$', '') ORDER BY 1), ' ') AS v
         FROM pg_namespace n WHERE n.nspname = ANY($1)
       UNION ALL
       SELECT 'rel ' || n.nspname || '.' || c.relname,
              pg_get_userbyid(c.relowner) || ' ' || array_to_string(ARRAY(
                SELECT regexp_replace(unnest(COALESCE(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END::"char", c.relowner)))::text, '/[^/]*$', '') ORDER BY 1), ' ')
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
       UNION ALL
       SELECT 'fn ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
              pg_get_userbyid(p.proowner) || ' ' || array_to_string(ARRAY(
                SELECT regexp_replace(unnest(COALESCE(p.proacl, acldefault('f', p.proowner)))::text, '/[^/]*$', '') ORDER BY 1), ' ')
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = ANY($1)`,
      [SCHEMAS],
    );
    const rls = await c.query(
      `SELECT n.nspname || '.' || c.relname AS k, c.relrowsecurity || '/' || c.relforcerowsecurity AS v
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p')`,
      [SCHEMAS],
    );
    const policies = await c.query(
      `SELECT schemaname || '.' || tablename || ' ' || policyname AS k,
              concat_ws(' | ', permissive, cmd, array_to_string(ARRAY(SELECT unnest(roles) ORDER BY 1), ','), qual, with_check) AS v
         FROM pg_policies WHERE schemaname = ANY($1)`,
      [SCHEMAS],
    );
    const journal = Number(
      (await c.query("SELECT count(*) AS n FROM drizzle.__drizzle_migrations"))
        .rows[0].n,
    );
    const toMap = (rows: { k: string; v: string | null }[]) =>
      Object.fromEntries(rows.map((r) => [r.k, r.v ?? ""]));
    return {
      acl: toMap(acl.rows),
      rls: toMap(rls.rows),
      policies: toMap(policies.rows),
      journal,
    };
  });
}

const diff = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys({ ...a, ...b })
    .filter((k) => a[k] !== b[k])
    .sort()
    .map(
      (k) =>
        `${k}: source=[${a[k] ?? "missing"}] restored=[${b[k] ?? "missing"}]`,
    );

// Tenant tables: app schema tables with a business_id column, plus app.business.
async function tenantTables(adminUrl: string) {
  return withClient(adminUrl, async (c) => {
    const { rows } = await c.query(
      `SELECT c.relname AS t, (c.relname = 'business') AS is_business
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p')
          AND (c.relname = 'business' OR EXISTS (
                SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'business_id' AND NOT a.attisdropped))
        ORDER BY 1`,
    );
    return rows as { t: string; is_business: boolean }[];
  });
}

// Runs one count as app_user inside a savepoint; a missing grant counts as zero
// rows visible (the grant model is itself verified by the ACL comparison).
async function visibleCount(c: pg.Client, sql: string, params: unknown[] = []) {
  await c.query("SAVEPOINT probe");
  try {
    const n = Number((await c.query(sql, params)).rows[0].n);
    await c.query("RELEASE SAVEPOINT probe");
    return n;
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT probe");
    if ((e as { code?: string }).code === "42501") return 0;
    throw e;
  }
}

async function tenantChecks(appUrl: string, adminUrl: string) {
  const tables = await tenantTables(adminUrl);
  const businessIds = await withClient(adminUrl, async (c) =>
    (
      await c.query("SELECT id::text AS id FROM app.business ORDER BY 1")
    ).rows.map((r) => String(r.id)),
  );
  return withClient(appUrl, async (c) => {
    const withoutContext: Record<string, number> = {};
    await c.query("BEGIN");
    for (const { t } of tables) {
      withoutContext[`app.${t}`] = await visibleCount(
        c,
        `SELECT count(*) AS n FROM app.${c.escapeIdentifier(t)}`,
      );
    }
    await c.query("ROLLBACK");

    const crossTenant: Record<string, number> = {};
    for (const id of businessIds) {
      await c.query("BEGIN");
      await c.query("SELECT set_config($1, $2, true)", [TENANT_GUC, id]);
      for (const { t, is_business } of tables) {
        const col = is_business ? "id" : "business_id";
        const n = await visibleCount(
          c,
          `SELECT count(*) AS n FROM app.${c.escapeIdentifier(t)} WHERE ${col}::text <> $1`,
          [id],
        );
        if (n > 0) crossTenant[`${id} app.${t}`] = n;
      }
      await c.query("ROLLBACK");
    }
    return {
      tenantTables: tables.map(({ t }) => `app.${t}`),
      rowsVisibleWithoutContext: Object.values(withoutContext).reduce(
        (a, b) => a + b,
        0,
      ),
      tablesVisibleWithoutContext: Object.keys(withoutContext).filter(
        (k) => withoutContext[k] > 0,
      ),
      businessesChecked: businessIds.length,
      crossTenantRowsVisible: crossTenant,
    };
  });
}

const repoMigrations = (
  JSON.parse(readFileSync("db/migrations/meta/_journal.json", "utf8")) as {
    entries: unknown[];
  }
).entries.length;

const dir = mkdtempSync(join(tmpdir(), "restore-drill-"));
const timings: Record<string, number> = {};
let t = Date.now();
const lap = (k: string) => {
  timings[k] = Date.now() - t;
  t = Date.now();
};
try {
  // 1. Backup: custom-format dump of our schemas (what the nightly job ships off-site).
  docker(
    [
      "-v",
      `${dir}:/out`,
      PG_IMAGE,
      "sh",
      "-c",
      `pg_dump "$PGSRC" -Fc ${SCHEMAS.map((s) => `-n ${s}`).join(" ")} -f /out/backup.pgc`,
    ],
    { PGSRC: libpq(sourceUrl) },
  );
  const dump = readFileSync(join(dir, "backup.pgc"));
  const sha256 = createHash("sha256").update(dump).digest("hex");
  const sourceCounts = await counts(sourceUrl);
  const sourceSecurity = await securitySnapshot(sourceUrl);
  lap("dumpMs");

  // 2. Restore into a fresh scratch database with the production roles.
  await withClient(targetAdminUrl, (c) =>
    c.query(`CREATE DATABASE ${c.escapeIdentifier(name)}`),
  );
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
  docker(
    [
      "-v",
      `${dir}:/out`,
      PG_IMAGE,
      "sh",
      "-c",
      'pg_restore --exit-on-error -d "$PGDST" /out/backup.pgc',
    ],
    {
      PGDST: libpq(withDb(target.DATABASE_URL_MIGRATION, name)),
    },
  );
  lap("restoreMs");

  // 3. Verify.
  const restoredCounts = await counts(targetUrl);
  const mismatched = Object.keys({ ...sourceCounts, ...restoredCounts }).filter(
    (k) => sourceCounts[k] !== restoredCounts[k],
  );
  const restoredSecurity = await securitySnapshot(targetUrl);
  const rlsViolations = await withClient(
    withDb(target.DATABASE_URL_MIGRATION, name),
    (c) => findRlsViolations(c),
  );
  const visibleWithoutTenant = await withClient(
    withDb(target.DATABASE_URL_APP, name),
    async (c) =>
      Number((await c.query("SELECT count(*) n FROM app.business")).rows[0].n),
  );
  const tenant = await tenantChecks(
    withDb(target.DATABASE_URL_APP, name),
    targetUrl,
  );
  lap("verifyMs");

  const grantsMismatched = diff(sourceSecurity.acl, restoredSecurity.acl);
  const rlsFlagsMismatched = diff(sourceSecurity.rls, restoredSecurity.rls);
  // Every tenant table must have RLS enabled and forced after the restore.
  const rlsNotEnabledAndForced = tenant.tenantTables.filter(
    (k) => restoredSecurity.rls[k] !== "true/true",
  );
  const policiesMismatched = diff(
    sourceSecurity.policies,
    restoredSecurity.policies,
  );
  const migrations = {
    repo: repoMigrations,
    source: sourceSecurity.journal,
    restored: restoredSecurity.journal,
  };

  const ok =
    mismatched.length === 0 &&
    rlsViolations.length === 0 &&
    visibleWithoutTenant === 0 &&
    migrations.restored > 0 &&
    migrations.restored === migrations.source &&
    migrations.source === migrations.repo &&
    grantsMismatched.length === 0 &&
    rlsFlagsMismatched.length === 0 &&
    rlsNotEnabledAndForced.length === 0 &&
    policiesMismatched.length === 0 &&
    tenant.rowsVisibleWithoutContext === 0 &&
    Object.keys(tenant.crossTenantRowsVisible).length === 0;

  const result = {
    ok,
    ranAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA ?? null,
    source: new URL(sourceUrl).hostname,
    target: `${new URL(targetAdminUrl).hostname}/${name}`,
    dump: { bytes: statSync(join(dir, "backup.pgc")).size, sha256 },
    tables: Object.keys(sourceCounts).length,
    rows: Object.values(sourceCounts).reduce((a, b) => a + b, 0),
    mismatched,
    migrations,
    rlsTables: Object.keys(restoredSecurity.rls).length,
    rlsViolations,
    rlsFlagsMismatched,
    rlsNotEnabledAndForced,
    policies: Object.keys(restoredSecurity.policies).length,
    policiesMismatched,
    aclEntries: Object.keys(restoredSecurity.acl).length,
    grantsMismatched,
    appUserRowsWithoutTenant: visibleWithoutTenant,
    tenantIsolation: tenant,
    timings,
    timeToRestoreMs: timings.restoreMs + timings.verifyMs,
  };
  const json = JSON.stringify(result, null, 2);
  console.log(json);
  if (process.env.DRILL_RESULT_FILE)
    writeFileSync(process.env.DRILL_RESULT_FILE, json + "\n");
  if (!ok) process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
  if (!keep) {
    await withClient(targetAdminUrl, (c) =>
      c.query(
        `DROP DATABASE IF EXISTS ${c.escapeIdentifier(name)} WITH (FORCE)`,
      ),
    );
  }
}
