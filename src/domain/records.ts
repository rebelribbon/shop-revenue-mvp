import { sql } from "drizzle-orm";
// Activity (timeline) and audit (security and money) writers. Every flow ends
// with an activity row, and an audit row where money, consent or access changes.
import { auditEvent, activity } from "@/db/schema";
import type { Tx, TenantTx } from "@/db/tenant";

export type RequestMeta = { requestId: string; ip?: string | null };

type AuditInput = {
  action: string;
  targetType: string;
  targetId: string | null;
  before?: unknown;
  after?: unknown;
};

// Tenant audit row: business and actor come from the transaction context.
export async function audit(tx: TenantTx, meta: RequestMeta, e: AuditInput) {
  const a = tx.actor;
  await tx.insert(auditEvent).values({
    businessId: tx.businessId,
    actorType: a.type,
    actorId: a.id,
    createdByUserId: a.type === "user" ? a.id : null,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId,
    before: e.before ?? null,
    after: e.after ?? null,
    ip: meta.ip ?? null,
    requestId: meta.requestId,
    supportSessionId: a.supportSessionId ?? null,
  });
}

// Platform audit row (spec issue 1): internal or system actions with no business,
// for example approveLegalPolicy. Only worker_user/admin_user can write these.
export async function auditPlatform(
  tx: Tx,
  meta: RequestMeta,
  actor: { type: "internal" | "system"; id: string | null },
  e: AuditInput,
) {
  await tx.insert(auditEvent).values({
    businessId: null,
    actorType: actor.type,
    actorId: actor.id,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId,
    before: e.before ?? null,
    after: e.after ?? null,
    ip: meta.ip ?? null,
    requestId: meta.requestId,
  });
}

export async function recordActivity(
  tx: TenantTx,
  e: { kind: string; subjectType: string; subjectId: string; summary: string; data?: Record<string, unknown>; recordedAtNow?: boolean },
) {
  const a = tx.actor;
  const [row] = await tx.insert(activity).values({
    businessId: tx.businessId,
    kind: e.kind,
    subjectType: e.subjectType,
    subjectId: e.subjectId,
    actorType: a.type === "internal" ? "support" : a.type,
    actorId: a.id,
    createdByUserId: a.type === "user" ? a.id : null,
    summary: e.summary,
    data: e.data ?? {},
    // Locked workflow commands are ordered by write time, not transaction start.
    occurredAt: e.recordedAtNow ? sql`clock_timestamp()` : undefined,
  }).returning();
  return row;
}

