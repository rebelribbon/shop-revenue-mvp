import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { Logger, runOnce, type WorkerEvents } from "graphile-worker";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { maintenancePool, withGlobalWorker, withTenant } from "@/db/tenant";
import { reconcileRevenue } from "./revenue";
import { closeExpiredSupportSessions } from "./support";
import { logger } from "@/lib/logger";
import { safeErrorDiagnostic } from "@/lib/errors";
export async function maintenanceStatus() {
  return withGlobalWorker(async (tx) => {
    const r = await tx.execute(
      sql`SELECT max(finished_at) FILTER(WHERE status='succeeded') AS last_success,max(started_at) AS last_attempt FROM app.maintenance_run`,
    );
    const last = r.rows[0].last_success as Date | null;
    return {
      healthy: !!last && Date.now() - new Date(last).getTime() < 26 * 3600000,
      lastSuccessAt: last ? new Date(last).toISOString() : null,
    };
  });
}
export async function runMaintenanceBatch({
  limit = 25,
  budgetMs = 90000,
}: { limit?: number; budgetMs?: number } = {}) {
  return withGlobalWorker(async (tx) => {
    const lock = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtextextended('shop-revenue-maintenance',0)) AS acquired`,
    );
    if (!lock.rows[0].acquired)
      return { status: "busy" as const, completed: 0, failed: 0 };
    const [started] = await tx
      .execute(sql`INSERT INTO app.maintenance_run DEFAULT VALUES RETURNING id`)
      .then((r) => r.rows);
    let completed = 0,
      failed = 0;
    const deadline = Date.now() + budgetMs;
    const events = new EventEmitter() as WorkerEvents;
    events.on("job:complete", ({ worker, error }) => {
      if (error) failed++;
      else completed++;
      if (completed + failed >= limit || Date.now() >= deadline)
        void worker.release();
    });
    const queueLogger = new Logger(() => (level) => {
      if (level === "error" || level === "warning")
        logger.warn({ event: "maintenance.queue_diagnostic", level });
    });
    try {
      await closeExpiredSupportSessions({
        requestId: `maintenance-${randomUUID()}`,
      });
      await tx.execute(
        sql`DELETE FROM app.auth_rate_limit WHERE window_start<now()-interval '2 hours'`,
      );
      await tx.execute(sql`SELECT app.purge_request_idempotency()`);
      await runOnce({
        pgPool: maintenancePool(),
        schema: "graphile_worker",
        concurrency: 1,
        noPreparedStatements: true,
        noHandleSignals: true,
        logger: queueLogger,
        events,
        taskList: {
          reconcile_revenue: async (payload) => {
            const businessId = z
              .uuid()
              .parse((payload as { business_id?: unknown }).business_id);
            await withTenant(
              businessId,
              { type: "system", id: null },
              async (tenant) => {
                await tenant.execute(sql`SET LOCAL statement_timeout='15s'`);
                await tenant.execute(sql`SET LOCAL lock_timeout='3s'`);
                await reconcileRevenue(
                  tenant,
                  { requestId: `maintenance-${randomUUID()}` },
                  "Scheduled revenue reconciliation",
                );
              },
              { role: "worker" },
            );
          },
        },
      });
      const status = failed ? "failed" : "succeeded";
      await tx.execute(
        sql`UPDATE app.maintenance_run SET finished_at=now(),status=${status},completed=${completed},failed=${failed} WHERE id=${started.id}`,
      );
      logger.info({
        event: "maintenance.completed",
        status,
        completed,
        failed,
      });
      return { status, completed, failed };
    } catch (error) {
      // Database errors inside this transaction must roll back, rather than leaving
      // a false success marker. A missing/failing heartbeat remains visibly stale.
      logger.error({
        event: "maintenance.failed",
        alert: true,
        ...safeErrorDiagnostic(error),
      });
      throw error;
    }
  });
}
