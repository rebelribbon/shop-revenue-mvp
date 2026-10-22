// Generic webhook inbox (F32, Section 18 process_webhook_event): every event is
// stored first, processed by the worker, retried with exponential backoff for
// 8 attempts (1 min growing to ~4 h), then dead and alerted. Admin replay
// re-queues it; applying an already-applied event is a no-op.
//
// Provider-specific handlers (applyStripeEvent, handleInboundSms, ...) arrive
// with their milestones; until a handler is registered, events are stored as
// `ignored` (Section 22: unknown event types stored as ignored).
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { withAdmin, type InternalActor } from "@/db/admin";
import { webhookEvent } from "@/db/schema";
import { withGlobalWorker, withTenant, type Tx } from "@/db/tenant";
import { AppError, notFound } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { audit, auditPlatform, type RequestMeta } from "./records";

export const MAX_WEBHOOK_ATTEMPTS = 8;
// Delay before attempt n+1, after n failures: 1 min × 2.5^(n-1) → 1, 2.5, 6, 16, 39, 98, 244 min.
export const retryDelayMs = (failures: number) => Math.round(60_000 * 2.5 ** (failures - 1));

export type WebhookEventRow = typeof webhookEvent.$inferSelect;
export type WebhookOutcome = "applied" | "ignored";
export type WebhookHandler = (event: WebhookEventRow) => Promise<WebhookOutcome>;

const handlers = new Map<string, WebhookHandler>();
const key = (provider: string, eventType: string) => `${provider}:${eventType}`;

export function registerWebhookHandler(provider: string, eventType: string, handler: WebhookHandler) {
  handlers.set(key(provider, eventType), handler);
  return () => handlers.delete(key(provider, eventType));
}

const STALE_PROCESSING = sql`now() - interval '15 minutes'`;

export async function processWebhookEvent(eventId: string): Promise<"applied" | "ignored" | "failed" | "dead" | "skipped"> {
  // Claim: only received/failed rows (or a processing row abandoned by a crashed worker).
  const claimed = await withGlobalWorker(async (tx) => {
    const [row] = await tx
      .select()
      .from(webhookEvent)
      .where(eq(webhookEvent.id, eventId))
      .for("update");
    if (!row) return null;
    const claimable =
      row.status === "received" ||
      row.status === "failed" ||
      (row.status === "processing" && (await isStale(tx, row.id)));
    if (!claimable) return null;
    const [updated] = await tx
      .update(webhookEvent)
      .set({ status: "processing", attempts: sql`${webhookEvent.attempts} + 1`, nextAttemptAt: null })
      .where(eq(webhookEvent.id, row.id))
      .returning();
    return updated;
  });
  if (!claimed) return "skipped";

  const handler = handlers.get(key(claimed.provider, claimed.eventType));
  try {
    const outcome: WebhookOutcome = handler ? await handler(claimed) : "ignored";
    await withGlobalWorker((tx) =>
      tx
        .update(webhookEvent)
        .set({ status: outcome, appliedAt: outcome === "applied" ? sql`now()` : null, lastError: null })
        .where(and(eq(webhookEvent.id, claimed.id), eq(webhookEvent.status, "processing"))),
    );
    logger.info({ event: "webhook.processed", webhookEventId: claimed.id, provider: claimed.provider, outcome, businessId: claimed.businessId });
    return outcome;
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : "unknown error";
    const dead = claimed.attempts >= MAX_WEBHOOK_ATTEMPTS;
    const runAt = new Date(Date.now() + retryDelayMs(claimed.attempts));
    await withGlobalWorker(async (tx) => {
      await tx
        .update(webhookEvent)
        .set({ status: dead ? "dead" : "failed", lastError: message, nextAttemptAt: dead ? null : runAt })
        .where(eq(webhookEvent.id, claimed.id));
      if (!dead) await enqueueProcessing(tx, claimed.id, runAt);
    });
    if (dead) {
      // Section 20 alert: "Webhook dead — Any".
      logger.error({ event: "alert.webhook_dead", alert: true, webhookEventId: claimed.id, provider: claimed.provider, eventType: claimed.eventType, attempts: claimed.attempts });
    } else {
      logger.warn({ event: "webhook.failed", webhookEventId: claimed.id, attempts: claimed.attempts, nextAttemptAt: runAt.toISOString() });
    }
    return dead ? "dead" : "failed";
  }
}

async function isStale(tx: Tx, id: string) {
  const r = await tx
    .select({ id: webhookEvent.id })
    .from(webhookEvent)
    .where(and(eq(webhookEvent.id, id), lt(webhookEvent.updatedAt, STALE_PROCESSING)));
  return r.length > 0;
}

async function enqueueProcessing(tx: Tx, eventId: string, runAt: Date | null) {
  await tx.execute(
    sql`SELECT app.enqueue_job('process_webhook_event', ${JSON.stringify({ webhook_event_id: eventId })}::jsonb,
                               ${runAt ? runAt.toISOString() : null}::timestamptz, 1, ${`webhook:${eventId}`})`,
  );
}

// I4: replay after the admin fixes the cause. Applied events stay applied (the
// processor will no-op); failed, dead and ignored events are re-queued.
export async function replayWebhookEvent(actor: InternalActor, meta: RequestMeta, eventId: string) {
  const result = await withAdmin(actor, async (tx) => {
    const [row] = await tx.select().from(webhookEvent).where(eq(webhookEvent.id, eventId)).for("update");
    if (!row) throw notFound("That webhook event");
    if (row.status === "processing" || row.status === "received") {
      throw new AppError("CONFLICT", "This event is already queued for processing.");
    }
    const requeued = ["failed", "dead", "ignored"].includes(row.status);
    if (requeued) {
      await tx
        .update(webhookEvent)
        .set({ status: "received", attempts: 0, nextAttemptAt: null })
        .where(eq(webhookEvent.id, row.id));
    }
    await enqueueProcessing(tx, row.id, null);
    const entry = {
      action: "webhook_event.replayed",
      targetType: "webhook_event",
      targetId: row.id,
      before: { status: row.status, attempts: row.attempts, lastError: row.lastError },
      after: { status: requeued ? "received" : row.status },
    };
    if (!row.businessId) await auditPlatform(tx, meta, { type: "internal", id: actor.internalUserId }, entry);
    return { row, requeued, entry };
  });
  // Events already resolved to a shop are also audited in that shop's log.
  if (result.row.businessId) {
    await withTenant(result.row.businessId, { type: "internal", id: actor.internalUserId }, (tx) => audit(tx, meta, result.entry), {
      role: "admin",
    });
  }
  return { status: result.requeued ? "received" : result.row.status };
}

export async function listWebhookEvents(filter: { provider?: string; status?: string; limit?: number }) {
  return withAdmin(null, (tx) =>
    tx
      .select({
        id: webhookEvent.id,
        provider: webhookEvent.provider,
        providerEventId: webhookEvent.providerEventId,
        eventType: webhookEvent.eventType,
        businessId: webhookEvent.businessId,
        status: webhookEvent.status,
        attempts: webhookEvent.attempts,
        lastError: webhookEvent.lastError,
        receivedAt: webhookEvent.receivedAt,
        appliedAt: webhookEvent.appliedAt,
        nextAttemptAt: webhookEvent.nextAttemptAt,
      })
      .from(webhookEvent)
      .where(
        and(
          filter.provider ? eq(webhookEvent.provider, filter.provider) : undefined,
          filter.status ? eq(webhookEvent.status, filter.status) : undefined,
        ),
      )
      .orderBy(desc(webhookEvent.receivedAt))
      .limit(filter.limit ?? 100),
  );
}

export async function getWebhookEvent(eventId: string) {
  const [row] = await withAdmin(null, (tx) => tx.select().from(webhookEvent).where(eq(webhookEvent.id, eventId)));
  return row ?? null;
}

