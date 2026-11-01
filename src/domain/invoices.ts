import { sealShareToken } from "@/lib/share-token";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  business,
  customer,
  estimateAuthorization,
  estimateVersion,
  invoice,
  invoicePayment,
  type InvoiceSnapshot,
} from "@/db/schema";
import { runInContext, type TenantTx } from "@/db/tenant";
import { AppError, notFound } from "@/lib/errors";
import { hashToken, isWellFormedToken, newToken } from "@/lib/tokens";
import { audit, recordActivity, type RequestMeta } from "./records";
import { estimateTotals } from "@/lib/estimate-tax";
import { lockRevenue, reconcileRevenue } from "./revenue";
import { assertOwner } from "./membership";
export async function issueInvoice(
  tx: TenantTx,
  meta: RequestMeta,
  input: { versionId: string; dueOn: string | null; terms: string },
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${"invoice-number:" + tx.businessId},0))`,
  );
  const [v] = await tx
    .select()
    .from(estimateVersion)
    .where(
      and(
        eq(estimateVersion.businessId, tx.businessId),
        eq(estimateVersion.id, input.versionId),
      ),
    );
  if (!v) throw notFound("That estimate");
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${v.quoteId},0))`,
  );
  const [latest] = await tx
    .select({ id: estimateVersion.id })
    .from(estimateVersion)
    .where(
      and(
        eq(estimateVersion.businessId, tx.businessId),
        eq(estimateVersion.quoteId, v.quoteId),
      ),
    )
    .orderBy(desc(estimateVersion.version))
    .limit(1);
  if (latest.id !== v.id)
    throw new AppError(
      "CONFLICT",
      "Use the latest estimate version before issuing the invoice.",
    );
  const [authorization] = await tx
    .select()
    .from(estimateAuthorization)
    .where(
      and(
        eq(estimateAuthorization.businessId, tx.businessId),
        eq(estimateAuthorization.versionId, v.id),
      ),
    );
  if (!authorization)
    throw new AppError(
      "VALIDATION",
      "The customer must authorize this estimate before it can be invoiced.",
    );
  const lines = v.snapshot.lines.filter((l) =>
    authorization.approvedLineIds.includes(l.id),
  );
  const { subtotalCents, taxCents, totalCents } = estimateTotals(
    lines,
    v.snapshot.taxBps,
  );
  if (totalCents <= 0)
    throw new AppError(
      "VALIDATION",
      "There is no approved billable work on this estimate.",
    );
  const [shop] = await tx
    .select()
    .from(business)
    .where(eq(business.id, tx.businessId));
  const snapshot: InvoiceSnapshot = {
    ...v.snapshot,
    lines,
    subtotalCents,
    taxCents,
    totalCents,
    shopPhone: shop.phoneE164,
    shopAddress: [
      shop.addressLine1,
      shop.addressLine2,
      shop.city,
      shop.region,
      shop.postalCode,
    ]
      .filter(Boolean)
      .join(", "),
  };
  const [sequence] = await tx
    .select({ number: sql<number>`coalesce(max(${invoice.number}),1000)+1` })
    .from(invoice)
    .where(eq(invoice.businessId, tx.businessId));
  const token = newToken();
  const [row] = await tx
    .insert(invoice)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      number: Number(sequence.number),
      quoteId: v.quoteId,
      versionId: v.id,
      authorizationId: authorization.id,
      customerId: v.customerId,
      vehicleId: v.vehicleId,
      serviceAssetId: v.serviceAssetId,
      snapshot,
      totalCents,
      dueOn: input.dueOn,
      invoiceTerms: input.terms,
      tokenHash: token.hash,
      shareTokenCiphertext: sealShareToken(token.token),
      expiresAt: new Date(Date.now() + 90 * 86400000),
    })
    .returning();
  await audit(tx, meta, {
    action: "invoice.issued",
    targetType: "invoice",
    targetId: row.id,
    after: {
      number: row.number,
      totalCents,
      versionId: v.id,
      authorizationId: authorization.id,
    },
  });
  await recordActivity(tx, {
    kind: "invoice.issued",
    subjectType: v.vehicleId ? "vehicle" : "customer",
    subjectId: v.vehicleId ?? v.customerId,
    summary: `Invoice #${row.number} issued`,
    data: { invoiceId: row.id },
  });
  const [person] = await tx
    .select({
      name: customer.displayName,
      phone: customer.phoneE164,
      email: customer.email,
    })
    .from(customer)
    .where(
      and(
        eq(customer.businessId, tx.businessId),
        eq(customer.id, v.customerId),
      ),
    );
  return {
    id: row.id,
    path: `/invoice/${token.token}`,
    share: { path: `/invoice/${token.token}`, ...person },
  };
}
export async function listInvoices(tx: TenantTx, id?: string, jobId?: string) {
  const invoices = await tx
    .select()
    .from(invoice)
    .where(
      and(
        eq(invoice.businessId, tx.businessId),
        id ? eq(invoice.id, id) : undefined,
        jobId ? eq(invoice.quoteId, jobId) : undefined,
      ),
    )
    .orderBy(desc(invoice.createdAt))
    .limit(100);
  const ids = invoices.map((i) => i.id);
  const payments = ids.length
    ? await tx
        .select()
        .from(invoicePayment)
        .where(
          and(
            eq(invoicePayment.businessId, tx.businessId),
            inArray(invoicePayment.invoiceId, ids),
          ),
        )
        .orderBy(desc(invoicePayment.createdAt))
    : [];
  return invoices.map((i) => {
    const entries = payments.filter((p) => p.invoiceId === i.id);
    const paidCents = entries.reduce((n, p) => n + p.amountCents, 0);
    return { ...i, entries, paidCents, balanceCents: i.totalCents - paidCents };
  });
}
async function requireInvoice(tx: TenantTx, id: string) {
  await lockRevenue(tx);
  const [row] = await tx
    .select()
    .from(invoice)
    .where(and(eq(invoice.businessId, tx.businessId), eq(invoice.id, id)))
    .for("update");
  if (!row) throw notFound("That invoice");
  return row;
}
export async function recordInvoicePayment(
  tx: TenantTx,
  meta: RequestMeta,
  input: {
    invoiceId: string;
    amountCents: number;
    method: string;
    reference: string;
  },
) {
  const i = await requireInvoice(tx, input.invoiceId);
  const [sum] = await tx
    .select({
      paid: sql<string>`coalesce(sum(${invoicePayment.amountCents}),0)`,
    })
    .from(invoicePayment)
    .where(
      and(
        eq(invoicePayment.businessId, tx.businessId),
        eq(invoicePayment.invoiceId, i.id),
      ),
    );
  if (input.amountCents > i.totalCents - Number(sum.paid))
    throw new AppError(
      "VALIDATION",
      "The amount exceeds the outstanding balance.",
    );
  const [p] = await tx
    .insert(invoicePayment)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      ...input,
    })
    .returning();
  await audit(tx, meta, {
    action: "invoice.payment_recorded",
    targetType: "invoice_payment",
    targetId: p.id,
    after: { invoiceId: i.id, amountCents: p.amountCents, method: p.method },
  });
  await recordActivity(tx, {
    kind: "invoice.payment_recorded",
    subjectType: i.vehicleId ? "vehicle" : "customer",
    subjectId: i.vehicleId ?? i.customerId,
    summary: `Payment recorded for invoice #${i.number}`,
    data: { invoiceId: i.id, paymentId: p.id },
  });
  await reconcileRevenue(tx, meta, "Payment recorded", i.customerId);
  return { id: p.id };
}
export async function reverseInvoicePayment(
  tx: TenantTx,
  meta: RequestMeta,
  paymentId: string,
  reason: string,
) {
  await assertOwner(tx);
  const [original] = await tx
    .select()
    .from(invoicePayment)
    .where(
      and(
        eq(invoicePayment.businessId, tx.businessId),
        eq(invoicePayment.id, paymentId),
      ),
    );
  if (!original) throw notFound("That payment");
  if (original.method === "stripe")
    throw new AppError(
      "INVALID_TRANSITION",
      "Use the Stripe refund control to refund an online payment.",
    );
  const sourceInvoice = await requireInvoice(tx, original.invoiceId);
  const [row] = await tx
    .insert(invoicePayment)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      invoiceId: original.invoiceId,
      amountCents: -original.amountCents,
      method: "reversal",
      reversesPaymentId: original.id,
      reason,
    })
    .returning();
  await audit(tx, meta, {
    action: "invoice.payment_reversed",
    targetType: "invoice_payment",
    targetId: row.id,
    after: { paymentId, reason },
  });
  await reconcileRevenue(
    tx,
    meta,
    "Manual payment reversed",
    sourceInvoice.customerId,
  );
  return { id: row.id };
}
export async function voidInvoice(
  tx: TenantTx,
  meta: RequestMeta,
  id: string,
  reason: string,
) {
  await assertOwner(tx);
  await requireInvoice(tx, id);
  const [row] = await tx
    .update(invoice)
    .set({ voidedAt: new Date(), voidReason: reason })
    .where(and(eq(invoice.businessId, tx.businessId), eq(invoice.id, id)))
    .returning();
  await audit(tx, meta, {
    action: "invoice.voided",
    targetType: "invoice",
    targetId: id,
    after: { reason },
  });
  await reconcileRevenue(tx, meta, "Invoice voided", row.customerId);
  return { id: row.id };
}
export async function rotateInvoiceLink(
  tx: TenantTx,
  meta: RequestMeta,
  id: string,
) {
  const token = newToken();
  const [row] = await tx
    .update(invoice)
    .set({
      tokenHash: token.hash,
      shareTokenCiphertext: sealShareToken(token.token),
      expiresAt: new Date(Date.now() + 90 * 86400000),
    })
    .where(and(eq(invoice.businessId, tx.businessId), eq(invoice.id, id)))
    .returning();
  if (!row) throw notFound("That invoice");
  await audit(tx, meta, {
    action: "invoice.link_rotated",
    targetType: "invoice",
    targetId: id,
  });
  return { id, path: `/invoice/${token.token}` };
}
export type PublicInvoice = {
  number: number;
  snapshot: InvoiceSnapshot;
  issuedAt: string;
  dueOn: string | null;
  terms: string;
  voided: boolean;
  totalCents: number;
  paidCents: number;
  onlinePaymentEnabled?: boolean;
};
export async function readPublicInvoice(
  token: string,
): Promise<PublicInvoice | null> {
  if (!isWellFormedToken(token)) return null;
  return runInContext(null, { type: "customer", id: null }, async (tx) => {
    const r = await tx.execute(
      sql`select app.read_invoice(${hashToken(token)}) as data`,
    );
    return (r.rows[0]?.data ?? null) as PublicInvoice | null;
  });
}

export async function setInvoiceDispute(
  tx: TenantTx,
  meta: RequestMeta,
  id: string,
  reason: string | null,
) {
  const before = await requireInvoice(tx, id);
  if (before.voidedAt)
    throw new AppError("INVALID_TRANSITION", "This invoice is void.");
  const [row] = await tx
    .update(invoice)
    .set({ disputeOpen: reason })
    .where(and(eq(invoice.businessId, tx.businessId), eq(invoice.id, id)))
    .returning();
  await audit(tx, meta, {
    action: reason ? "invoice.dispute_opened" : "invoice.dispute_resolved",
    targetType: "invoice",
    targetId: id,
    before: { disputeOpen: before.disputeOpen },
    after: { disputeOpen: reason },
  });
  await recordActivity(tx, {
    kind: "invoice.dispute_updated",
    subjectType: "customer",
    subjectId: row.customerId,
    summary: `Invoice #${row.number}: dispute ${reason ? "opened" : "resolved"}`,
    data: { invoiceId: id, reason },
  });
  await reconcileRevenue(
    tx,
    meta,
    reason ? "Dispute opened" : "Dispute resolved",
    row.customerId,
  );
  return { id };
}
