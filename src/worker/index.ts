// The one worker process (D1): Graphile Worker on Postgres, connected as
// worker_user over a direct/session connection (LISTEN/NOTIFY; Section 25).
process.env.DB_RUNTIME_ROLE = "worker";
process.env.SERVICE_NAME = process.env.SERVICE_NAME ?? "worker";

const { run } = await import("graphile-worker");
const { taskList, crontab } = await import("./tasks");
const { logger } = await import("@/lib/logger");
const { initServerObservability } = await import("@/lib/observability");

initServerObservability("worker");
const connectionString = process.env.DATABASE_URL_WORKER_SESSION ?? process.env.DATABASE_URL_WORKER;
if (!connectionString) throw new Error("DATABASE_URL_WORKER is not configured");

const runner = await run({
  connectionString,
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
  schema: "graphile_worker",
  taskList,
  crontab,
  // Migrations are applied by migration_owner (scripts/db/migrate.ts), never by the worker.
  noPreparedStatements: true,
});
logger.info({ event: "worker.started" });

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    logger.info({ event: "worker.stopping", signal: sig });
    void runner.stop().then(() => process.exit(0));
  });
}
await runner.promise;

export {};
