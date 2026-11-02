// Milestone 1 job handlers (Section 18). Every job that touches tenant data runs
// inside withTenant with the payload's business_id; these M1 jobs are global.
import { randomUUID } from "node:crypto";
import type { TaskList } from "graphile-worker";
import { sql } from "drizzle-orm";
import { reconcileRevenue } from "@/domain/revenue";
import { z } from "zod";
import { withTenant, withGlobalWorker } from "@/db/tenant";
import { closeExpiredSupportSessions } from "@/domain/support";
import { routeStripeEvent, STRIPE_EVENT_TYPES } from "@/domain/stripe-events";
import type Stripe from "stripe";
import { registerWebhookHandler } from "@/domain/webhooks";
import { processWebhookEvent } from "@/domain/webhooks";
import { logger } from "@/lib/logger";

for (const eventType of STRIPE_EVENT_TYPES) {
  registerWebhookHandler("stripe", eventType, async (row) =>
    (await routeStripeEvent(row.payload as Stripe.Event))
      ? "applied"
      : "ignored",
  );
}

const meta = (job: string) => ({ requestId: `job-${job}-${randomUUID()}` });

export const taskList: TaskList = {
  reconcile_revenue: async (payload) => {
    const businessId = z
      .uuid()
      .parse((payload as { business_id?: unknown }).business_id);
    await withTenant(
      businessId,
      { type: "system", id: null },
      (tx) =>
        reconcileRevenue(
          tx,
          meta("reconcile_revenue"),
          "Nightly evidence reconciliation",
        ),
      { role: "worker" },
    );
  },
  process_webhook_event: async (payload) => {
    const id = (payload as { webhook_event_id?: string }).webhook_event_id;
    if (!id) throw new Error("process_webhook_event: missing webhook_event_id");
    await processWebhookEvent(id);
  },
  // Graphile records each cron execution in _private_known_crontabs; the health
  // route and queue-lag alert read it through app.worker_status().
  heartbeat: async () => {
    logger.debug({ event: "worker.heartbeat" });
  },
  close_expired_support_sessions: async () => {
    const n = await closeExpiredSupportSessions(
      meta("close_expired_support_sessions"),
    );
    if (n) logger.info({ event: "support_session.expired", count: n });
  },
  purge_request_idempotency: async () => {
    const r = await withGlobalWorker((tx) =>
      tx.execute<{ n: number }>(
        sql`SELECT app.purge_request_idempotency() AS n`,
      ),
    );
    logger.info({
      event: "purge_request_idempotency",
      deleted: r.rows[0]?.n ?? 0,
    });
  },
};

export const crontab = [
  "* * * * * heartbeat",
  "*/5 * * * * close_expired_support_sessions",
  "15 8 * * * purge_request_idempotency",
].join("\n");
