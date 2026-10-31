// Legal policy manager (I5, D14): draft versions, approval by a second admin
// with an attorney memo reference, retirement. Platform-level, audited with
// business_id NULL (spec issue 1).
import { and, desc, eq, sql } from "drizzle-orm";
import { withAdmin, type InternalActor } from "@/db/admin";
import { internalUser, legalPolicy } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { auditPlatform, type RequestMeta } from "./records";

export const POLICY_KINDS = [
  "estimate_authorization",
  "invoice_terms",
  "sms_consent_disclosure",
  "recovery_footer",
  "retention_rules",
  "texting_attestation",
] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

async function assertAdminRole(tx: Tx, internalUserId: string) {
  const [u] = await tx
    .select()
    .from(internalUser)
    .where(eq(internalUser.id, internalUserId));
  if (!u?.active || u.role !== "admin")
    throw forbidden("Only admins can manage legal policies.");
}

export async function listPolicies() {
  return withAdmin(null, (tx) =>
    tx
      .select()
      .from(legalPolicy)
      .orderBy(
        legalPolicy.jurisdictionCode,
        legalPolicy.kind,
        desc(legalPolicy.version),
      ),
  );
}

export async function createPolicyDraft(
  actor: InternalActor,
  meta: RequestMeta,
  input: { jurisdictionCode: string; kind: PolicyKind; body: string },
) {
  return withAdmin(actor, async (tx) => {
    await assertAdminRole(tx, actor.internalUserId);
    // Serialize version numbering per (jurisdiction, kind).
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`legal_policy:${input.jurisdictionCode}:${input.kind}`}, 0))`,
    );
    const [{ next }] = await tx
      .select({
        next: sql<number>`coalesce(max(${legalPolicy.version}), 0)::int + 1`,
      })
      .from(legalPolicy)
      .where(
        and(
          eq(legalPolicy.jurisdictionCode, input.jurisdictionCode),
          eq(legalPolicy.kind, input.kind),
        ),
      );
    const [p] = await tx
      .insert(legalPolicy)
      .values({
        jurisdictionCode: input.jurisdictionCode,
        kind: input.kind,
        version: next,
        body: input.body,
        bodySha256: "", // computed by the legal_policy_guard trigger
        createdByInternalUserId: actor.internalUserId,
      })
      .returning();
    await auditPlatform(
      tx,
      meta,
      { type: "internal", id: actor.internalUserId },
      {
        action: "legal_policy.drafted",
        targetType: "legal_policy",
        targetId: p.id,
        after: {
          jurisdictionCode: p.jurisdictionCode,
          kind: p.kind,
          version: p.version,
          bodySha256: p.bodySha256,
        },
      },
    );
    return p;
  });
}

export async function updatePolicyDraft(
  actor: InternalActor,
  meta: RequestMeta,
  policyId: string,
  body: string,
) {
  return withAdmin(actor, async (tx) => {
    await assertAdminRole(tx, actor.internalUserId);
    const [before] = await tx
      .select()
      .from(legalPolicy)
      .where(eq(legalPolicy.id, policyId));
    if (!before) throw notFound("That policy");
    if (before.status !== "draft")
      throw new AppError("INVALID_TRANSITION", "Only drafts can be edited.");
    const [p] = await tx
      .update(legalPolicy)
      .set({ body })
      .where(eq(legalPolicy.id, policyId))
      .returning();
    await auditPlatform(
      tx,
      meta,
      { type: "internal", id: actor.internalUserId },
      {
        action: "legal_policy.edited",
        targetType: "legal_policy",
        targetId: p.id,
        before: { bodySha256: before.bodySha256 },
        after: { bodySha256: p.bodySha256 },
      },
    );
    return p;
  });
}

// approveLegalPolicy: a second admin (not the drafter) approves; the previously
// approved version for that jurisdiction and kind is retired in the same transaction.
export async function approvePolicy(
  actor: InternalActor,
  meta: RequestMeta,
  input: { policyId: string; approvalReference: string },
) {
  const reference = input.approvalReference.trim();
  if (!reference)
    throw new AppError("VALIDATION", "Enter the attorney memo reference.", {
      field: "approvalReference",
    });
  return withAdmin(actor, async (tx) => {
    await assertAdminRole(tx, actor.internalUserId);
    const [p] = await tx
      .select()
      .from(legalPolicy)
      .where(eq(legalPolicy.id, input.policyId))
      .for("update");
    if (!p) throw notFound("That policy");
    if (p.status !== "draft")
      throw new AppError("INVALID_TRANSITION", "Only drafts can be approved.");
    if (p.createdByInternalUserId === actor.internalUserId) {
      throw forbidden("A second admin must approve a policy you drafted.");
    }
    const retired = await tx
      .update(legalPolicy)
      .set({ status: "retired", retiredAt: sql`now()` })
      .where(
        and(
          eq(legalPolicy.jurisdictionCode, p.jurisdictionCode),
          eq(legalPolicy.kind, p.kind),
          eq(legalPolicy.status, "approved"),
        ),
      )
      .returning({ id: legalPolicy.id, version: legalPolicy.version });
    const [approved] = await tx
      .update(legalPolicy)
      .set({
        status: "approved",
        approvedBy: actor.internalUserId,
        approvedAt: sql`now()`,
        approvalReference: reference,
      })
      .where(eq(legalPolicy.id, p.id))
      .returning();
    for (const r of retired) {
      await auditPlatform(
        tx,
        meta,
        { type: "internal", id: actor.internalUserId },
        {
          action: "legal_policy.retired",
          targetType: "legal_policy",
          targetId: r.id,
          before: { status: "approved" },
          after: { status: "retired", supersededBy: approved.id },
        },
      );
    }
    await auditPlatform(
      tx,
      meta,
      { type: "internal", id: actor.internalUserId },
      {
        action: "legal_policy.approved",
        targetType: "legal_policy",
        targetId: approved.id,
        before: { status: "draft" },
        after: {
          status: "approved",
          version: approved.version,
          bodySha256: approved.bodySha256,
          approvalReference: reference,
          draftedBy: approved.createdByInternalUserId,
        },
      },
    );
    return approved;
  });
}

export async function retirePolicy(
  actor: InternalActor,
  meta: RequestMeta,
  policyId: string,
) {
  return withAdmin(actor, async (tx) => {
    await assertAdminRole(tx, actor.internalUserId);
    const [p] = await tx
      .update(legalPolicy)
      .set({ status: "retired", retiredAt: sql`now()` })
      .where(
        and(eq(legalPolicy.id, policyId), eq(legalPolicy.status, "approved")),
      )
      .returning();
    if (!p)
      throw new AppError(
        "INVALID_TRANSITION",
        "Only an approved policy can be retired.",
      );
    await auditPlatform(
      tx,
      meta,
      { type: "internal", id: actor.internalUserId },
      {
        action: "legal_policy.retired",
        targetType: "legal_policy",
        targetId: p.id,
        before: { status: "approved" },
        after: { status: "retired" },
      },
    );
    return p;
  });
}
