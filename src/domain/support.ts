// Support view-as (Section 9): read-only, written reason, 60 minutes, one audit
// event at start and at end, listed in the owner's support access log (S29).
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { withAdmin, type InternalActor } from "@/db/admin";
import { business, internalUser, supportSession } from "@/db/schema";
import { withGlobalWorker, withTenant, type TenantTx } from "@/db/tenant";
import { AppError, notFound } from "@/lib/errors";
import { audit, type RequestMeta } from "./records";

export const SUPPORT_SESSION_MINUTES = 60;

function asTenant(tx: object, businessId: string, actor: TenantTx["actor"]) {
  return Object.assign(Object.create(tx), { businessId, actor }) as TenantTx;
}

export async function startSupportSession(actor: InternalActor, meta: RequestMeta, input: { businessId: string; reason: string }) {
  const reason = input.reason.trim();
  if (reason.length < 10) throw new AppError("VALIDATION", "Write a reason of at least 10 characters.", { field: "reason" });
  return withAdmin(actor, async (tx) => {
    const [b] = await tx.select({ id: business.id }).from(business).where(eq(business.id, input.businessId));
    if (!b) throw notFound("That business");
    const [me] = await tx.select().from(internalUser).where(eq(internalUser.id, actor.internalUserId));
    if (!me?.active) throw new AppError("FORBIDDEN", "Your admin access is not active.");
    const [s] = await tx
      .insert(supportSession)
      // expires_at is set by the database (started_at + 60 minutes); the value here is ignored.
      .values({ adminUserId: me.id, adminDisplayName: me.displayName, businessId: b.id, reason, expiresAt: new Date() })
      .returning();
    await tx.execute(sql`SELECT set_config('app.business_id', ${b.id}, true)`);
    await audit(asTenant(tx, b.id, { type: "internal", id: actor.internalUserId, supportSessionId: s.id }), meta, {
      action: "support_session.started",
      targetType: "support_session",
      targetId: s.id,
      after: { reason, expiresAt: s.expiresAt },
    });
    return s;
  });
}

export async function endSupportSession(actor: InternalActor, meta: RequestMeta, sessionId: string) {
  return withAdmin(actor, async (tx) => {
    const [s] = await tx
      .update(supportSession)
      .set({ endedAt: sql`least(now(), ${supportSession.expiresAt})`, endReason: "ended" })
      .where(and(eq(supportSession.id, sessionId), eq(supportSession.adminUserId, actor.internalUserId), isNull(supportSession.endedAt)))
      .returning();
    if (!s) return null;
    await tx.execute(sql`SELECT set_config('app.business_id', ${s.businessId}, true)`);
    await audit(asTenant(tx, s.businessId, { type: "internal", id: actor.internalUserId, supportSessionId: s.id }), meta, {
      action: "support_session.ended",
      targetType: "support_session",
      targetId: s.id,
      after: { endedAt: s.endedAt, endReason: "ended" },
    });
    return s;
  });
}

// For the shop UI resolver: is this view-as session live and owned by this internal user?
export async function findActiveSupportSession(internalUserId: string, sessionId: string) {
  return withAdmin({ internalUserId }, async (tx) => {
    const [s] = await tx
      .select({
        id: supportSession.id,
        businessId: supportSession.businessId,
        expiresAt: supportSession.expiresAt,
        businessName: sql<string>`coalesce(${business.dba}, ${business.legalName})`,
      })
      .from(supportSession)
      .innerJoin(business, eq(business.id, supportSession.businessId))
      .innerJoin(internalUser, eq(internalUser.id, supportSession.adminUserId))
      .where(
        and(
          eq(supportSession.id, sessionId),
          eq(supportSession.adminUserId, internalUserId),
          isNull(supportSession.endedAt),
          gt(supportSession.expiresAt, sql`now()`),
          eq(internalUser.active, true),
        ),
      );
    return s ?? null;
  });
}

// Worker cron: sessions that ran out are ended at their expiry and audited once.
export async function closeExpiredSupportSessions(meta: RequestMeta) {
  const expired = await withGlobalWorker((tx) =>
    tx
      .update(supportSession)
      .set({ endedAt: supportSession.expiresAt, endReason: "expired" })
      .where(and(isNull(supportSession.endedAt), lt(supportSession.expiresAt, sql`now()`)))
      .returning(),
  );
  for (const s of expired) {
    await withTenant(
      s.businessId,
      { type: "system", id: null },
      (tx) =>
        audit(tx, meta, {
          action: "support_session.expired",
          targetType: "support_session",
          targetId: s.id,
          after: { endedAt: s.endedAt, endReason: "expired", adminUserId: s.adminUserId },
        }),
      { role: "worker" },
    );
  }
  return expired.length;
}

// S29: the owner's support access log (who, when, reason, duration).
export async function listSupportAccess(tx: TenantTx) {
  return tx
    .select({
      id: supportSession.id,
      reason: supportSession.reason,
      startedAt: supportSession.startedAt,
      expiresAt: supportSession.expiresAt,
      endedAt: supportSession.endedAt,
      endReason: supportSession.endReason,
      adminDisplayName: supportSession.adminDisplayName,
    })
    .from(supportSession)
    .where(eq(supportSession.businessId, tx.businessId))
    .orderBy(desc(supportSession.startedAt));
}
