import pg from "pg";
import type { TestProject } from "vitest/node";
import { bootstrapRoles } from "../../scripts/db/bootstrap";
import { migrateDatabase } from "../../scripts/db/migrate";
import { loadEnv, requireEnv } from "../../scripts/lib/env";

declare module "vitest" {
  export interface ProvidedContext {
    testDb: {
      name: string;
      urls: Record<
        "bootstrap" | "migration" | "app" | "worker" | "admin",
        string
      >;
    };
  }
}

const withDb = (url: string, name: string) => {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
};

export default async function setup(project: TestProject) {
  loadEnv();
  const bootstrap = requireEnv("DATABASE_URL_BOOTSTRAP");
  const name =
    process.env.TEST_DATABASE_NAME ?? `test_${Date.now()}_${process.pid}`;
  const admin = new pg.Client({ connectionString: bootstrap });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const urls = {
    bootstrap: withDb(bootstrap, name),
    migration: withDb(requireEnv("DATABASE_URL_MIGRATION"), name),
    app: withDb(requireEnv("DATABASE_URL_APP"), name),
    worker: withDb(requireEnv("DATABASE_URL_WORKER"), name),
    admin: withDb(requireEnv("DATABASE_URL_ADMIN"), name),
  };
  await bootstrapRoles({
    bootstrapUrl: urls.bootstrap,
    databaseName: name,
    passwords: {
      migration_owner: requireEnv("MIGRATION_OWNER_PASSWORD"),
      app_user: requireEnv("APP_USER_PASSWORD"),
      worker_user: requireEnv("WORKER_USER_PASSWORD"),
      admin_user: requireEnv("ADMIN_USER_PASSWORD"),
    },
  });
  await migrateDatabase(urls.migration, { quiet: true });
  const previous = { ...process.env };
  Object.assign(process.env, {
    APP_ENV: "test",
    DATABASE_URL_APP: urls.app,
    DATABASE_URL_WORKER: urls.worker,
    DATABASE_URL_ADMIN: urls.admin,
  });
  await (
    await import("../../scripts/dev/test-authorization-policy")
  ).seedTestAuthorizationPolicy();
  await (await import("../../src/db/tenant")).closePools();
  for (const key of [
    "APP_ENV",
    "DATABASE_URL_APP",
    "DATABASE_URL_WORKER",
    "DATABASE_URL_ADMIN",
  ]) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  project.provide("testDb", { name, urls });

  return async () => {
    if (process.env.KEEP_TEST_DB) return;
    const c = new pg.Client({ connectionString: bootstrap });
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await c.end();
  };
}
