import { shareRecipient } from "./document-sharing";
import { partLineCents } from "./job-costing";
import { sealShareToken } from "@/lib/share-token";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  activity,
  business,
  legalPolicy,
  invoice,
  estimateRecommendationLine,
  estimateAuthorization,
  authorizationSummaryColumns,
  estimateVersion,
  recommendation,
  type EstimateSnapshot,
} from "@/db/schema";
import { type TenantTx, runInContext } from "@/db/tenant";
import { jobInput } from "./jobs";
import { serviceAssetLabel } from "./service-assets";
import { getCustomerWithVehicles, getVehicle } from "./customers";
import { newToken, hashToken, isWellFormedToken } from "@/lib/tokens";
import { AppError, notFound } from "@/lib/errors";
import { audit, recordActivity, type RequestMeta } from "./records";
import { estimateTotals } from "@/lib/estimate-tax";
import {
  completeDecisions,
  signatureSchema,
  lineDecisionSchema,
  type LineDecision,
  type SignatureStrokes,
} from "@/lib/estimate-decisions";
import { authorizationPdf } from "./authorization-pdf";
import { z } from "zod";
export async function freezeEstimate(
  tx: TenantTx,
  meta: RequestMeta,
  input: {
    jobId: string;
    expectedJobVersion: string;
    taxBps: number;
    supplementReason: string;
    terms: string;
  },
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${input.jobId},0))`,
  );
  const [job] = await tx
    .select()
    .from(activity)
    .where(
      and(
        eq(activity.businessId, tx.businessId),
        eq(activity.subjectId, input.jobId),
        eq(activity.kind, "job.costed"),
      ),
    )
    .orderBy(desc(activity.occurredAt), desc(activity.id))
    .limit(1);
  if (!job) throw notFound("That job");
  if (job.id !== input.expectedJobVersion)
    throw new AppError(
      "CONFLICT",
      "The job changed. Refresh before publishing.",
    );
  const [issued] = await tx
    .select({ id: invoice.id })
    .from(invoice)
    .where(
      and(
        eq(invoice.businessId, tx.businessId),
        eq(invoice.quoteId, input.jobId),
        sql`${invoice.voidedAt} IS NULL`,
      ),
    );
  if (issued)
    throw new AppError(
      "CONFLICT",
      "This job has an issued invoice. Create a new job for additional work.",
    );
  const data = jobInput.parse(job.data);
  const c = await getCustomerWithVehicles(tx, data.customerId);
  const v = data.vehicleId
    ? await getVehicle(tx, data.customerId, data.vehicleId)
    : null;
  const serviceLabel = data.serviceAssetId
    ? await serviceAssetLabel(tx, data.customerId, data.serviceAssetId)
    : undefined;
  const [shop] = await tx
    .select()
    .from(business)
    .where(eq(business.id, tx.businessId));
  const [policy] = await tx
    .select()
    .from(legalPolicy)
    .where(
      and(
        eq(legalPolicy.jurisdictionCode, shop.jurisdictionCode),
        eq(legalPolicy.kind, "estimate_authorization"),
        eq(legalPolicy.status, "approved"),
      ),
    );
  if (!policy)
    throw new AppError(
      "VALIDATION",
      "An approved authorization policy is required before publishing customer estimates. Contact the platform administrator.",
    );
  const [prior] = await tx
    .select()
    .from(estimateVersion)
    .where(
      and(
        eq(estimateVersion.businessId, tx.businessId),
        eq(estimateVersion.quoteId, input.jobId),
      ),
    )
    .orderBy(desc(estimateVersion.version))
    .limit(1);
  if (prior && !input.supplementReason.trim())
    throw new AppError(
      "VALIDATION",
      "Explain the change for this new version or supplement.",
    );
  if (prior)
    await tx
      .update(recommendation)
      .set({ status: "quoted" })
      .where(
        and(
          eq(recommendation.businessId, tx.businessId),
          eq(recommendation.status, "open"),
          inArray(
            recommendation.sourceVersionId,
            tx
              .select({ id: estimateVersion.id })
              .from(estimateVersion)
              .where(
                and(
                  eq(estimateVersion.businessId, tx.businessId),
                  eq(estimateVersion.quoteId, input.jobId),
                ),
              ),
          ),
        ),
      );
  const lines: EstimateSnapshot["lines"] = [
    ...data.parts.map((p, i) => ({
      id: `part-${i}`,
      description: p.description,
      kind: "part" as const,
      quantity: p.quantity,
      unitPriceCents: p.unitPriceCents,
      totalCents: partLineCents(p.quantity, p.unitPriceCents),
      taxable: p.taxable ?? shop.partsTaxableDefault,
    })),
    ...data.labor.map((l, i) => ({
      id: `labor-${i}`,
      description: l.description,
      kind: "labor" as const,
      quantity: l.estimatedHoursHundredths / 100,
      unitPriceCents: l.sellRateCents,
      totalCents: Math.round(
        (l.estimatedHoursHundredths * l.sellRateCents) / 100,
      ),
      taxable: l.taxable ?? shop.laborTaxableDefault,
    })),
  ];
  if (!lines.length)
    throw new AppError("VALIDATION", "Add work to the job before publishing.");
  if (
    !Number.isInteger(input.taxBps) ||
    input.taxBps < 0 ||
    input.taxBps > 2000
  )
    throw new AppError("VALIDATION", "Enter a tax rate between 0% and 20%.");
  const { subtotalCents, taxCents } = estimateTotals(lines, input.taxBps);
  const snapshot: EstimateSnapshot = {
    title: data.title,
    shopName: shop.dba || shop.legalName,
    customerName: c.customer.displayName,
    vehicleLabel: v
      ? [v.year, v.make, v.model, v.plate].filter(Boolean).join(" ") ||
        "Vehicle"
      : "",
    ...(serviceLabel ? { serviceLabel } : {}),
    lines,
    subtotalCents,
    taxBps: input.taxBps,
    taxCents,
    totalCents: subtotalCents + taxCents,
    terms: input.terms,
    authorizationPolicy: {
      id: policy.id,
      version: policy.version,
      jurisdictionCode: policy.jurisdictionCode,
      body: policy.body,
      bodySha256: policy.bodySha256,
    },
  };
  // Superseding a version revokes its link but never removes its signature evidence.
  await tx
    .update(estimateVersion)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(estimateVersion.businessId, tx.businessId),
        eq(estimateVersion.quoteId, input.jobId),
      ),
    );
  const token = newToken();
  const [row] = await tx
    .insert(estimateVersion)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      quoteId: input.jobId,
      version: (prior?.version ?? 0) + 1,
      sourceRecoveryItemId: data.sourceRecoveryItemId ?? null,
      sourceContactActivityId: data.sourceContactActivityId ?? null,
      sourceAppointmentId: data.sourceAppointmentId ?? null,
      customerId: data.customerId,
      vehicleId: data.vehicleId ?? null,
      serviceAssetId: data.serviceAssetId ?? null,
      snapshot,
      supplementReason: input.supplementReason || null,
      tokenHash: token.hash,
      shareTokenCiphertext: sealShareToken(token.token),
      expiresAt: new Date(Date.now() + 30 * 86400000),
    })
    .returning();
  for (const [kind, entries] of [
    ["part", data.parts],
    ["labor", data.labor],
  ] as const)
    for (const [index, line] of entries.entries())
      if (line.recommendationId) {
        await tx.insert(estimateRecommendationLine).values({
          businessId: tx.businessId,
          createdByUserId: tx.actor.id,
          versionId: row.id,
          lineId: `${kind}-${index}`,
          recommendationId: line.recommendationId,
        });
        await tx
          .update(recommendation)
          .set({ status: "quoted" })
          .where(
            and(
              eq(recommendation.businessId, tx.businessId),
              eq(recommendation.id, line.recommendationId),
              eq(recommendation.status, "open"),
            ),
          );
      }
  await audit(tx, meta, {
    action: "estimate.published",
    targetType: "estimate_version",
    targetId: row.id,
    after: { version: row.version, totalCents: snapshot.totalCents },
  });
  await recordActivity(tx, {
    kind: "estimate.published",
    subjectType: data.vehicleId ? "vehicle" : "customer",
    subjectId: data.vehicleId ?? data.customerId,
    summary: `Estimate version ${row.version} published`,
    data: { versionId: row.id },
  });
  return {
    id: row.id,
    version: row.version,
    path: `/estimate/${token.token}`,
    share: {
      path: `/estimate/${token.token}`,
      ...(await shareRecipient(tx, c.customer.id)),
    },
  };
}
export async function listEstimates(tx: TenantTx, jobId?: string) {
  return tx
    .select({
      id: estimateVersion.id,
      quoteId: estimateVersion.quoteId,
      version: estimateVersion.version,
      snapshot: estimateVersion.snapshot,
      revokedAt: estimateVersion.revokedAt,
      expiresAt: estimateVersion.expiresAt,
      supplementReason: estimateVersion.supplementReason,
      authorization: authorizationSummaryColumns,
    })
    .from(estimateVersion)
    .leftJoin(
      estimateAuthorization,
      and(
        eq(estimateAuthorization.businessId, estimateVersion.businessId),
        eq(estimateAuthorization.versionId, estimateVersion.id),
      ),
    )
    .where(
      and(
        eq(estimateVersion.businessId, tx.businessId),
        jobId ? eq(estimateVersion.quoteId, jobId) : undefined,
      ),
    )
    .orderBy(desc(estimateVersion.createdAt), desc(estimateVersion.version))
    .limit(100);
}
export async function revokeEstimate(
  tx: TenantTx,
  meta: RequestMeta,
  id: string,
) {
  const [row] = await tx
    .update(estimateVersion)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(estimateVersion.businessId, tx.businessId),
        eq(estimateVersion.id, id),
      ),
    )
    .returning();
  if (!row) throw notFound("That estimate");
  await audit(tx, meta, {
    action: "estimate.revoked",
    targetType: "estimate_version",
    targetId: id,
  });
  return { id };
}
export type PublicEstimate = {
  id: string;
  version: number;
  supplementReason: string | null;
  snapshot: EstimateSnapshot;
  estimateSha256: string;
  expiresAt: string;
  authorization: null | {
    signerName: string;
    approvedLineIds: string[];
    signedAt: string;
    consentText: string;
  };
};
export async function readPublicEstimate(
  token: string,
): Promise<PublicEstimate | null> {
  if (!isWellFormedToken(token)) return null;
  return runInContext(null, { type: "customer", id: null }, async (tx) => {
    const r = await tx.execute(
      sql`select app.read_estimate(${hashToken(token)}) as data`,
    );
    return (r.rows[0]?.data ?? null) as PublicEstimate | null;
  });
}
export async function signEstimate(
  token: string,
  name: string,
  decisions: LineDecision[],
  meta: RequestMeta,
  signature: SignatureStrokes,
) {
  if (!isWellFormedToken(token)) throw notFound("That estimate");
  const strokes = signatureSchema.parse(signature);
  const choices = z.array(lineDecisionSchema).max(200).parse(decisions);
  return runInContext(null, { type: "customer", id: null }, async (tx) => {
    const read = await tx.execute(
      sql`select app.read_estimate(${hashToken(token)}) as data`,
    );
    const estimate = read.rows[0]?.data as PublicEstimate | null;
    if (
      !estimate ||
      estimate.authorization ||
      !estimate.snapshot.authorizationPolicy
    )
      throw notFound("That unsigned estimate");
    if (
      !completeDecisions(
        estimate.snapshot.lines.map((l) => l.id),
        choices,
      )
    )
      throw new AppError(
        "VALIDATION",
        "Choose Approve or Decline for every item.",
      );
    const signedAt = new Date().toISOString();
    const pdf = await authorizationPdf({
      estimate,
      name,
      decisions: choices,
      signature: strokes,
      meta,
      signedAt,
    });
    await tx.execute(
      sql`select app.authorize_estimate(${hashToken(token)},${name},${JSON.stringify(choices)}::jsonb,${meta.ip ?? null},${meta.requestId},${meta.userAgent ?? null},${JSON.stringify(strokes)}::jsonb,${estimate.estimateSha256},${signedAt}::timestamptz,${pdf.toString("base64")})`,
    );
    return { signed: true };
  });
}
export async function readPublicAuthorizationPdf(token: string) {
  if (!isWellFormedToken(token)) return null;
  return runInContext(null, { type: "customer", id: null }, async (tx) => {
    const result = await tx.execute(
      sql`select app.read_authorization_pdf(${hashToken(token)}) as pdf`,
    );
    return (result.rows[0]?.pdf ?? null) as string | null;
  });
}

export async function rotateEstimateLink(
  tx: TenantTx,
  meta: RequestMeta,
  id: string,
) {
  const token = newToken();
  const [row] = await tx
    .update(estimateVersion)
    .set({
      tokenHash: token.hash,
      shareTokenCiphertext: sealShareToken(token.token),
      expiresAt: new Date(Date.now() + 30 * 86400000),
    })
    .where(
      and(
        eq(estimateVersion.businessId, tx.businessId),
        eq(estimateVersion.id, id),
        sql`${estimateVersion.revokedAt} IS NULL`,
      ),
    )
    .returning();
  if (!row) throw notFound("That active estimate");
  await audit(tx, meta, {
    action: "estimate.link_rotated",
    targetType: "estimate_version",
    targetId: id,
  });
  return { id, path: `/estimate/${token.token}` };
}
