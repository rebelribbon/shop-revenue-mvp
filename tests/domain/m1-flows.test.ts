// Domain tests (Section 22): Milestone 1 flows end to end inside transactions
// against the test database.
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { withAdmin } from "@/db/admin";
import { auditEvent, legalPolicy, membership, webhookEvent } from "@/db/schema";
import { ingestWebhookEvent, withGlobalWorker, withTenant } from "@/db/tenant";
import { updateBusinessProfile } from "@/domain/business";
import {
  approvePolicy,
  createPolicyDraft,
  retirePolicy,
  updatePolicyDraft,
} from "@/domain/legal-policy";
import {
  acceptInvite,
  inviteStaff,
  listTeam,
  removeStaff,
  resendInvite,
} from "@/domain/membership";
import {
  closeExpiredSupportSessions,
  endSupportSession,
  findActiveSupportSession,
  listSupportAccess,
  startSupportSession,
} from "@/domain/support";
import {
  MAX_WEBHOOK_ATTEMPTS,
  processWebhookEvent,
  registerWebhookHandler,
  replayWebhookEvent,
  retryDelayMs,
} from "@/domain/webhooks";
import {
  clientOf,
  createInternalUser,
  meta,
  rawClient,
  seedTenant,
  type SeededTenant,
} from "../helpers/fixtures";

describe("team: Owner + one Staff (D15, S28)", () => {
  let T: SeededTenant;
  beforeAll(async () => {
    T = await seedTenant("Echo");
  });

  it("Owner invites Staff; Staff accepts with the invited email and gets access", async () => {
    const email = `tech-${randomUUID()}@example.test`;
    const inv = await withTenant(T.businessId, T.owner.actor, (tx) =>
      inviteStaff(tx, meta(), { name: "Tech", email }),
    );
    expect(inv.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Only the hash is stored.
    const stored = await withTenant(T.businessId, T.owner.actor, (tx) =>
      tx
        .select({ h: membership.inviteTokenHash })
        .from(membership)
        .where(eq(membership.id, inv.membershipId)),
    );
    expect(stored[0].h).not.toContain(inv.token);
    expect(stored[0].h).toMatch(/^[0-9a-f]{64}$/);

    await expect(
      acceptInvite(meta(), inv.token, {
        authSubject: randomUUID(),
        email: "someone-else@example.test",
        phoneE164: null,
        displayName: "X",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const staff = await acceptInvite(meta(), inv.token, {
      authSubject: randomUUID(),
      email,
      phoneE164: null,
      displayName: "Tech",
    });
    expect(staff.role).toBe("staff");
    // The token is single-use.
    await expect(
      acceptInvite(meta(), inv.token, {
        authSubject: randomUUID(),
        email,
        phoneE164: null,
        displayName: "Tech",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const team = await withTenant(T.businessId, T.owner.actor, (tx) =>
      listTeam(tx),
    );
    expect(team.map((m) => [m.role, m.status])).toEqual([
      ["owner", "active"],
      ["staff", "active"],
    ]);
    T.staff = {
      userId: staff.userId,
      authSubject: "",
      email,
      actor: { type: "user", id: staff.userId },
    };
  });

  it("the owner can invite more staff, up to the seat limit", async () => {
    const shop = await seedTenant("Seats", { withStaff: true });
    await withTenant(shop.businessId, shop.owner.actor, async (tx) => {
      // One active staff already; fill the remaining 14 seats.
      for (let n = 2; n <= 15; n++)
        await inviteStaff(tx, meta(), {
          name: `Staff ${n}`,
          email: `staff${n}@example.test`,
        });
    });
    await expect(
      withTenant(shop.businessId, shop.owner.actor, (tx) =>
        inviteStaff(tx, meta(), {
          name: "Sixteenth",
          email: "sixteenth@example.test",
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("Staff is forbidden from Owner-only actions (server-side)", async () => {
    const staff = T.staff!.actor;
    await expect(
      withTenant(T.businessId, staff, (tx) =>
        inviteStaff(tx, meta(), { name: "Z", email: "z@example.test" }),
      ),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const team = await withTenant(T.businessId, staff, (tx) => listTeam(tx));
    await expect(
      withTenant(T.businessId, staff, (tx) =>
        removeStaff(tx, meta(), team[1].id),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("Owner removes Staff; the owner cannot be removed; removal is audited", async () => {
    const team = await withTenant(T.businessId, T.owner.actor, (tx) =>
      listTeam(tx),
    );
    await expect(
      withTenant(T.businessId, T.owner.actor, (tx) =>
        removeStaff(tx, meta(), team[0].id),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await withTenant(T.businessId, T.owner.actor, (tx) =>
      removeStaff(tx, meta(), team[1].id),
    );
    const after = await withTenant(T.businessId, T.owner.actor, (tx) =>
      listTeam(tx),
    );
    expect(after).toHaveLength(1);
    const audits = await withTenant(T.businessId, T.owner.actor, (tx) =>
      tx
        .select()
        .from(auditEvent)
        .where(eq(auditEvent.action, "membership.removed")),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].actorId).toBe(T.owner.userId);
  });

  it("a pending invite can be revoked, and resending rotates the token", async () => {
    const inv = await withTenant(T.businessId, T.owner.actor, (tx) =>
      inviteStaff(tx, meta(), {
        name: "Phone tech",
        phoneE164: "+15125550142",
      }),
    );
    const again = await withTenant(T.businessId, T.owner.actor, (tx) =>
      resendInvite(tx, meta(), inv.membershipId),
    );
    expect(again.token).not.toBe(inv.token);
    await expect(
      acceptInvite(meta(), inv.token, {
        authSubject: randomUUID(),
        email: null,
        phoneE164: "+15125550142",
        displayName: "P",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await withTenant(T.businessId, T.owner.actor, (tx) =>
      removeStaff(tx, meta(), inv.membershipId),
    );
    await expect(
      acceptInvite(meta(), again.token, {
        authSubject: randomUUID(),
        email: null,
        phoneE164: "+15125550142",
        displayName: "P",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("an expired invite is unavailable", async () => {
    const inv = await withTenant(T.businessId, T.owner.actor, (tx) =>
      inviteStaff(tx, meta(), { name: "Late", email: "late@example.test" }),
    );
    await withAdmin(null, async () => undefined);
    const c = await rawClient("app");
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.business_id', $1, true)", [
      T.businessId,
    ]);
    await c.query(
      "UPDATE app.membership SET invite_expires_at = now() - interval '1 minute' WHERE id = $1",
      [inv.membershipId],
    );
    await c.query("COMMIT");
    await c.end();
    await expect(
      acceptInvite(meta(), inv.token, {
        authSubject: randomUUID(),
        email: "late@example.test",
        phoneE164: null,
        displayName: "L",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("business profile updates are audited with before/after", async () => {
    await withTenant(T.businessId, T.owner.actor, (tx) =>
      updateBusinessProfile(tx, meta(), { taxRateBps: 825, city: "Austin" }),
    );
    const [a] = await withTenant(T.businessId, T.owner.actor, (tx) =>
      tx
        .select()
        .from(auditEvent)
        .where(eq(auditEvent.action, "business.profile_updated")),
    );
    expect(a.before).toEqual({ taxRateBps: 0, city: null });
    expect(a.after).toEqual({ taxRateBps: 825, city: "Austin" });
  });
});

describe("support view-as (Section 9)", () => {
  let T: SeededTenant;
  let support: { id: string; displayName: string };
  beforeAll(async () => {
    T = await seedTenant("Foxtrot");
    support = await createInternalUser("support", "Sam Support");
  });

  it("requires a written reason", async () => {
    await expect(
      startSupportSession({ internalUserId: support.id }, meta(), {
        businessId: T.businessId,
        reason: "look",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("is time-boxed, read-only, audited at start and end, and listed in the owner's access log", async () => {
    const s = await startSupportSession(
      { internalUserId: support.id },
      meta(),
      {
        businessId: T.businessId,
        reason: "Owner asked why invite email did not arrive",
      },
    );
    expect(s.expiresAt.getTime() - s.startedAt.getTime()).toBe(60 * 60 * 1000);
    expect(await findActiveSupportSession(support.id, s.id)).toMatchObject({
      businessId: T.businessId,
    });
    // Another internal user cannot ride this session.
    const other = await createInternalUser("support");
    expect(await findActiveSupportSession(other.id, s.id)).toBeNull();

    const viewAs = {
      type: "support" as const,
      id: support.id,
      supportSessionId: s.id,
    };
    // Reads work under the shop's tenant context.
    const team = await withTenant(T.businessId, viewAs, (tx) => listTeam(tx));
    expect(team).toHaveLength(1);
    // Mutations are forbidden by the database even if application code forgot to check.
    await expect(
      withTenant(T.businessId, viewAs, (tx) =>
        updateBusinessProfile(tx, meta(), { city: "Hacked" }),
      ),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ code: "25006" }),
    });

    await endSupportSession({ internalUserId: support.id }, meta(), s.id);
    expect(await findActiveSupportSession(support.id, s.id)).toBeNull();

    const log = await withTenant(T.businessId, T.owner.actor, (tx) =>
      listSupportAccess(tx),
    );
    expect(log[0]).toMatchObject({
      reason: "Owner asked why invite email did not arrive",
      adminDisplayName: "Sam Support",
      endReason: "ended",
    });
    const audits = await withTenant(T.businessId, T.owner.actor, (tx) =>
      tx
        .select({ action: auditEvent.action, sid: auditEvent.supportSessionId })
        .from(auditEvent)
        .where(eq(auditEvent.supportSessionId, s.id)),
    );
    expect(audits.map((a) => a.action).sort()).toEqual([
      "support_session.ended",
      "support_session.started",
    ]);
  });

  it("expired sessions are closed by the worker and audited once", async () => {
    const s = await startSupportSession(
      { internalUserId: support.id },
      meta(),
      { businessId: T.businessId, reason: "Checking the expiry job works" },
    );
    // Simulate the hour passing: rewrite the timestamps as the owner role (test only).
    const c = await rawClient("migration");
    await c.query("BEGIN");
    await c.query(
      "ALTER TABLE app.support_session DISABLE TRIGGER support_session_guard",
    );
    await c.query(
      "CREATE POLICY t_tmp ON app.support_session FOR ALL TO migration_owner USING (true)",
    );
    await c.query(
      "UPDATE app.support_session SET started_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE id = $1",
      [s.id],
    );
    await c.query("DROP POLICY t_tmp ON app.support_session");
    await c.query(
      "ALTER TABLE app.support_session ENABLE TRIGGER support_session_guard",
    );
    await c.query("COMMIT");
    await c.end();
    expect(await closeExpiredSupportSessions(meta())).toBeGreaterThanOrEqual(1);
    expect(await closeExpiredSupportSessions(meta())).toBe(0);
    const log = await withTenant(T.businessId, T.owner.actor, (tx) =>
      listSupportAccess(tx),
    );
    expect(log.find((l) => l.id === s.id)).toMatchObject({
      endReason: "expired",
    });
  });
});

describe("legal policy manager (I5)", () => {
  it("a second admin approves; the previous approved version retires; audits have no business", async () => {
    const drafter = await createInternalUser("admin", "Drafter");
    const approver = await createInternalUser("admin", "Approver");
    const supportAgent = await createInternalUser("support");
    const kind = "sms_consent_disclosure";
    const jur = "US-NM";
    const v1 = await createPolicyDraft({ internalUserId: drafter.id }, meta(), {
      jurisdictionCode: jur,
      kind,
      body: "Version one",
    });
    await expect(
      createPolicyDraft({ internalUserId: supportAgent.id }, meta(), {
        jurisdictionCode: jur,
        kind,
        body: "x",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      approvePolicy({ internalUserId: drafter.id }, meta(), {
        policyId: v1.id,
        approvalReference: "MEMO-1",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await approvePolicy({ internalUserId: approver.id }, meta(), {
      policyId: v1.id,
      approvalReference: "MEMO-1",
    });
    const v2 = await createPolicyDraft({ internalUserId: drafter.id }, meta(), {
      jurisdictionCode: jur,
      kind,
      body: "Version two draft",
    });
    expect(v2.version).toBe(2);
    await updatePolicyDraft(
      { internalUserId: drafter.id },
      meta(),
      v2.id,
      "Version two",
    );
    await approvePolicy({ internalUserId: approver.id }, meta(), {
      policyId: v2.id,
      approvalReference: "MEMO-2",
    });
    const rows = await withAdmin(null, (tx) =>
      tx
        .select()
        .from(legalPolicy)
        .where(eq(legalPolicy.jurisdictionCode, jur))
        .orderBy(legalPolicy.version),
    );
    expect(rows.map((r) => r.status)).toEqual(["retired", "approved"]);
    expect(rows[1]).toMatchObject({
      approvedBy: approver.id,
      approvalReference: "MEMO-2",
    });

    const audits = await withAdmin(null, (tx) =>
      tx
        .select()
        .from(auditEvent)
        .where(
          sql`${auditEvent.targetId} IN (${v1.id}, ${v2.id}) AND ${auditEvent.businessId} IS NULL`,
        ),
    );
    expect(audits.map((a) => a.action).sort()).toEqual([
      "legal_policy.approved",
      "legal_policy.approved",
      "legal_policy.drafted",
      "legal_policy.drafted",
      "legal_policy.edited",
      "legal_policy.retired",
    ]);
    // Shops can read approved and retired versions but not drafts.
    const T = await seedTenant("Golf");
    const v3 = await createPolicyDraft({ internalUserId: drafter.id }, meta(), {
      jurisdictionCode: jur,
      kind,
      body: "Unapproved",
    });
    const visible = await withTenant(T.businessId, T.owner.actor, (tx) =>
      tx
        .select({ id: legalPolicy.id, status: legalPolicy.status })
        .from(legalPolicy)
        .where(eq(legalPolicy.jurisdictionCode, jur)),
    );
    expect(visible.map((v) => v.status).sort()).toEqual([
      "approved",
      "retired",
    ]);
    expect(visible.find((v) => v.id === v3.id)).toBeUndefined();
    await retirePolicy({ internalUserId: approver.id }, meta(), v2.id);
  });
});

describe("webhook inbox (F32, Section 18)", () => {
  const ingest = (eventType = "test.event") =>
    ingestWebhookEvent({
      provider: "stripe",
      providerEventId: `evt_${randomUUID()}`,
      eventType,
      payload: { hello: "world" },
    });
  const status = async (id: string) =>
    (
      await withGlobalWorker((tx) =>
        tx.select().from(webhookEvent).where(eq(webhookEvent.id, id)),
      )
    )[0];

  it("stores first and enqueues processing in the same transaction; duplicates are acknowledged and ignored", async () => {
    const providerEventId = `evt_${randomUUID()}`;
    const a = await ingestWebhookEvent({
      provider: "stripe",
      providerEventId,
      eventType: "x.y",
      payload: {},
    });
    const b = await ingestWebhookEvent({
      provider: "stripe",
      providerEventId,
      eventType: "x.y",
      payload: { different: true },
    });
    expect(a.duplicate).toBe(false);
    expect(b).toEqual({ eventId: a.eventId, duplicate: true });
    const jobs = await withGlobalWorker((tx) =>
      clientOf(tx).query(
        `SELECT count(*)::int n FROM graphile_worker._private_jobs j JOIN graphile_worker._private_tasks t ON t.id = j.task_id
        WHERE t.identifier = 'process_webhook_event' AND j.payload->>'webhook_event_id' = $1`,
        [a.eventId],
      ),
    );
    expect(jobs.rows[0].n).toBe(1);
  });

  it("unknown event types are stored as ignored", async () => {
    const e = await ingest("unknown.type");
    expect(await processWebhookEvent(e.eventId)).toBe("ignored");
    expect((await status(e.eventId)).status).toBe("ignored");
  });

  it("applies once; processing an applied event again is a no-op", async () => {
    let calls = 0;
    const off = registerWebhookHandler("stripe", "test.apply", async () => {
      calls++;
      return "applied";
    });
    const e = await ingest("test.apply");
    expect(await processWebhookEvent(e.eventId)).toBe("applied");
    expect(await processWebhookEvent(e.eventId)).toBe("skipped");
    const admin = await createInternalUser("admin");
    await replayWebhookEvent({ internalUserId: admin.id }, meta(), e.eventId);
    expect(await processWebhookEvent(e.eventId)).toBe("skipped");
    expect(calls).toBe(1);
    off();
  });

  it("failures retry with backoff, go dead after 8 attempts, and replay re-runs after the fix", async () => {
    let broken = true;
    const off = registerWebhookHandler("stripe", "test.flaky", async () => {
      if (broken) throw new Error("downstream bug");
      return "applied";
    });
    const e = await ingest("test.flaky");
    for (let i = 1; i < MAX_WEBHOOK_ATTEMPTS; i++) {
      expect(await processWebhookEvent(e.eventId)).toBe("failed");
      const row = await status(e.eventId);
      expect(row.attempts).toBe(i);
      expect(row.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(
        retryDelayMs(i) - 5_000,
      );
    }
    expect(await processWebhookEvent(e.eventId)).toBe("dead");
    expect(await status(e.eventId)).toMatchObject({
      status: "dead",
      attempts: 8,
      lastError: "downstream bug",
    });
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(7)).toBeGreaterThan(3.5 * 3600_000); // ~4 h

    broken = false;
    const admin = await createInternalUser("admin");
    expect(
      await replayWebhookEvent({ internalUserId: admin.id }, meta(), e.eventId),
    ).toMatchObject({ status: "received", requeued: true });
    expect(await processWebhookEvent(e.eventId)).toBe("applied");
    const replays = await withAdmin(null, (tx) =>
      tx
        .select()
        .from(auditEvent)
        .where(
          sql`${auditEvent.targetId} = ${e.eventId} AND ${auditEvent.action} = 'webhook_event.replayed'`,
        ),
    );
    expect(replays).toHaveLength(1);
    off();
  });
});
