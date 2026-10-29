// Webhook replay (I4) atomicity: the state change, the job enqueue and the
// required audit row commit together or not at all, for tenant-resolved and
// platform-level events; applied events are never re-queued.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { withAdmin, withAdminTenant } from "@/db/admin";
import { auditEvent, webhookEvent } from "@/db/schema";
import { ingestWebhookEvent, withGlobalWorker, withTenant } from "@/db/tenant";
import { processWebhookEvent, registerWebhookHandler, replayWebhookEvent } from "@/domain/webhooks";
import { createInternalUser, meta, rawClient, seedTenant, type SeededTenant } from "../helpers/fixtures";

let T: SeededTenant;
let adminId: string;

beforeAll(async () => {
  T = await seedTenant("Mike");
  adminId = (await createInternalUser("admin")).id;
});

// A stored event in a given state, optionally resolved to a business, with its
// ingest job removed so later job counts measure only what replay enqueues.
async function eventIn(status: "dead" | "failed" | "ignored" | "applied", businessId: string | null) {
  const { eventId } = await ingestWebhookEvent({
    provider: "stripe",
    providerEventId: `evt_${randomUUID()}`,
    eventType: "test.replay",
    payload: { test: true },
  });
  const w = await rawClient("worker");
  await w.query(
    `UPDATE app.webhook_event SET status = $2, attempts = CASE WHEN $2 = 'dead' THEN 8 ELSE 1 END,
            business_id = $3, last_error = CASE WHEN $2 IN ('dead', 'failed') THEN 'boom' END,
            applied_at = CASE WHEN $2 = 'applied' THEN now() END
      WHERE id = $1`,
    [eventId, status, businessId],
  );
  await w.query("DELETE FROM graphile_worker._private_jobs WHERE key = $1", [`webhook:${eventId}`]);
  await w.end();
  return eventId;
}

const jobsFor = async (eventId: string) => {
  const w = await rawClient("worker");
  const { rows } = await w.query("SELECT count(*)::int n FROM graphile_worker._private_jobs WHERE key = $1", [`webhook:${eventId}`]);
  await w.end();
  return rows[0].n as number;
};
const eventRow = async (id: string) => (await withGlobalWorker((tx) => tx.select().from(webhookEvent).where(eq(webhookEvent.id, id))))[0];
const tenantAudits = (businessId: string, eventId: string) =>
  withAdminTenant(businessId, { internalUserId: adminId }, (tx) =>
    tx.select().from(auditEvent).where(and(eq(auditEvent.targetId, eventId), eq(auditEvent.targetType, "webhook_event"))),
  );
const platformAudits = (eventId: string) =>
  withAdmin(null, (tx) => tx.select().from(auditEvent).where(and(eq(auditEvent.targetId, eventId), eq(auditEvent.targetType, "webhook_event"))));

// Makes every replay audit insert fail inside the database, then removes the trigger.
async function withFailingReplayAudit<T>(fn: () => Promise<T>) {
  const c = await rawClient("migration");
  await c.query(`
    CREATE FUNCTION app.test_fail_replay_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.action LIKE 'webhook_event.replay%' THEN RAISE EXCEPTION 'forced audit failure'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER test_fail_replay_audit BEFORE INSERT ON app.audit_event
      FOR EACH ROW EXECUTE FUNCTION app.test_fail_replay_audit();`);
  try {
    return await fn();
  } finally {
    await c.query("DROP TRIGGER test_fail_replay_audit ON app.audit_event; DROP FUNCTION app.test_fail_replay_audit();");
    await c.end();
  }
}

describe("webhook replay is atomic with its audit (I4)", () => {
  it("tenant-resolved replay: requeue, job and the shop's audit row commit together", async () => {
    const id = await eventIn("dead", T.businessId);
    const r = await replayWebhookEvent({ internalUserId: adminId }, meta(), id);
    expect(r).toMatchObject({ status: "received", requeued: true });
    expect(await eventRow(id)).toMatchObject({ status: "received", attempts: 0 });
    expect(await jobsFor(id)).toBe(1);
    const audits = await tenantAudits(T.businessId, id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      businessId: T.businessId,
      actorType: "internal",
      actorId: adminId,
      action: "webhook_event.replayed",
      before: { status: "dead", attempts: 8, lastError: "boom" },
      after: { status: "received", requeued: true },
    });
    // It lands in the shop's own log (S29 "recent account activity"), not the platform log.
    const ownerSees = await withTenant(T.businessId, T.owner.actor, (tx) =>
      tx.select({ id: auditEvent.id }).from(auditEvent).where(eq(auditEvent.targetId, id)),
    );
    expect(ownerSees).toHaveLength(1);
    expect(await platformAudits(id)).toHaveLength(0);
  });

  it("tenant-resolved replay: a failed audit insert rolls back the requeue and the job", async () => {
    const id = await eventIn("dead", T.businessId);
    await withFailingReplayAudit(() =>
      expect(replayWebhookEvent({ internalUserId: adminId }, meta(), id)).rejects.toMatchObject({ cause: expect.objectContaining({ message: "forced audit failure" }) }),
    );
    expect(await eventRow(id)).toMatchObject({ status: "dead", attempts: 8, lastError: "boom" });
    expect(await jobsFor(id)).toBe(0);
    expect(await tenantAudits(T.businessId, id)).toHaveLength(0);
  });

  it("platform-level replay: a failed audit insert rolls back too", async () => {
    const id = await eventIn("failed", null);
    await withFailingReplayAudit(() =>
      expect(replayWebhookEvent({ internalUserId: adminId }, meta(), id)).rejects.toMatchObject({ cause: expect.objectContaining({ message: "forced audit failure" }) }),
    );
    expect(await eventRow(id)).toMatchObject({ status: "failed", attempts: 1 });
    expect(await jobsFor(id)).toBe(0);
    expect(await platformAudits(id)).toHaveLength(0);
  });

  it("platform-level replay (no business resolved) is audited as a platform row", async () => {
    const id = await eventIn("ignored", null);
    const r = await replayWebhookEvent({ internalUserId: adminId }, meta(), id);
    expect(r).toMatchObject({ status: "received", requeued: true });
    expect(await jobsFor(id)).toBe(1);
    const audits = await platformAudits(id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ businessId: null, actorType: "internal", actorId: adminId, action: "webhook_event.replayed" });
  });

  it("an applied event stays applied, enqueues no job, and the no-op is audited", async () => {
    for (const businessId of [T.businessId, null]) {
      const id = await eventIn("applied", businessId);
      const before = await eventRow(id);
      const r = await replayWebhookEvent({ internalUserId: adminId }, meta(), id);
      expect(r).toEqual({ status: "applied", requeued: false, message: "Already applied; nothing was re-queued." });
      expect(await jobsFor(id)).toBe(0);
      const after = await eventRow(id);
      expect(after).toMatchObject({ status: "applied", attempts: before.attempts, updatedAt: before.updatedAt });
      const audits = businessId ? await tenantAudits(businessId, id) : await platformAudits(id);
      expect(audits.map((a) => a.action)).toEqual(["webhook_event.replay_noop"]);
    }
  });

  it("an applied event that is replayed is still never applied twice", async () => {
    let calls = 0;
    const off = registerWebhookHandler("stripe", "test.replay", async () => {
      calls++;
      return "applied";
    });
    const id = await eventIn("failed", T.businessId);
    await replayWebhookEvent({ internalUserId: adminId }, meta(), id);
    expect(await processWebhookEvent(id)).toBe("applied");
    await replayWebhookEvent({ internalUserId: adminId }, meta(), id);
    expect(await processWebhookEvent(id)).toBe("skipped");
    expect(calls).toBe(1);
    off();
  });

  it("a second replay while queued is a CONFLICT and writes nothing", async () => {
    const id = await eventIn("dead", T.businessId);
    await replayWebhookEvent({ internalUserId: adminId }, meta(), id);
    await expect(replayWebhookEvent({ internalUserId: adminId }, meta(), id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await jobsFor(id)).toBe(1);
    expect(await tenantAudits(T.businessId, id)).toHaveLength(1);
  });

  it("duplicate provider deliveries still store one event", async () => {
    const providerEventId = `evt_${randomUUID()}`;
    const a = await ingestWebhookEvent({ provider: "stripe", providerEventId, eventType: "x.y", payload: {} });
    const b = await ingestWebhookEvent({ provider: "stripe", providerEventId, eventType: "x.y", payload: {} });
    expect(b).toEqual({ eventId: a.eventId, duplicate: true });
    expect(await jobsFor(a.eventId)).toBe(1);
  });
});
