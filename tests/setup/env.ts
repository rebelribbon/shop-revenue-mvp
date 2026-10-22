import { afterAll, inject } from "vitest";
import { closePools } from "@/db/tenant";

const db = inject("testDb");
process.env.APP_ENV = "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
process.env.DATABASE_URL_MIGRATION = db.urls.migration;
process.env.DATABASE_URL_APP = db.urls.app;
process.env.DATABASE_URL_WORKER = db.urls.worker;
process.env.DATABASE_URL_ADMIN = db.urls.admin;

afterAll(async () => {
  await closePools();
});
