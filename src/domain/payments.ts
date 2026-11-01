import { and, eq, inArray, sql } from "drizzle-orm";
import type Stripe from "stripe";
import {
  invoice,
  invoiceCheckout,
  invoicePayment,
  invoiceRefund,
  stripeConnection,
} from "@/db/schema";
import {
  runInContext,
  withGlobalWorker,
  withTenant,
  type TenantTx,
} from "@/db/tenant";
import { AppError, notFound } from "@/lib/errors";
import { hashToken, isWellFormedToken } from "@/lib/tokens";
import { stripeLivemode } from "@/lib/stripe";
import { assertOwner } from "./membership";
import { audit, recordActivity, type RequestMeta } from "./records";

import { lockRevenue, reconcileRevenue } from "./revenue";

export const activeCheckoutStates = ["creating", "open", "processing"];
export async function getStripeConnection(tx: TenantTx) {
  const [c] = await tx
    .select()
    .from(stripeConnection)
    .where(eq(stripeConnection.businessId, tx.businessId));
  return c ?? null;
}
export async function prepareStripeConnection(tx: TenantTx) {
  await assertOwner(tx);
  const c = await getStripeConnection(tx);
  if (c) return c;
  const [row] = await tx
    .insert(stripeConnection)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      livemode: stripeLivemode(),
    })
    .returning();
  return row;
}
export async function resolveInvoicePaymentToken(token: string) {
  if (!isWellFormedToken(token)) throw notFound("That invoice link");
  return runInContext(null, { type: "customer", id: null }, async (tx) => {
    const r = await tx.execute(
      sql`select invoice_id,business_id from app.invoice_payment_context(${hashToken(token)})`,
    );
    const row = r.rows[0] as
      { invoice_id: string; business_id: string } | undefined;
    if (!row) throw notFound("That invoice link");
    return { invoiceId: row.invoice_id, businessId: row.business_id };
  });
}
export async function lockInvoice(tx: TenantTx, id: string) {
  await lockRevenue(tx);
  const [i] = await tx
    .select()
    .from(invoice)
    .where(and(eq(invoice.businessId, tx.businessId), eq(invoice.id, id)))
    .for("update");
  if (!i) throw notFound("That invoice");
  return i;
}
export async function reserveCheckout(tx: TenantTx, invoiceId: string) {
  const i = await lockInvoice(tx, invoiceId);
  if (i.voidedAt)
    throw new AppError("INVALID_TRANSITION", "This invoice is void.");
  const c = await getStripeConnection(tx);
  if (
    !c?.accountId ||
    c.livemode !== stripeLivemode() ||
    c.cardPaymentsStatus !== "active"
  )
    throw new AppError(
      "NOT_ELIGIBLE",
      "The shop has not enabled online payments yet.",
    );
  const [prior] = await tx
    .select()
    .from(invoiceCheckout)
    .where(
      and(
        eq(invoiceCheckout.businessId, tx.businessId),
        eq(invoiceCheckout.invoiceId, i.id),
        inArray(invoiceCheckout.status, activeCheckoutStates),
      ),
    );
  if (prior) return prior;
  const [pending] = await tx
    .select()
    .from(invoiceRefund)
    .where(
      and(
        eq(invoiceRefund.businessId, tx.businessId),
        eq(invoiceRefund.invoiceId, i.id),
        inArray(invoiceRefund.status, ["creating", "pending"]),
      ),
    );
  if (pending)
    throw new AppError(
      "CONFLICT",
      "A refund is still processing. Please contact the shop.",
    );
  const [s] = await tx
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
  const amount = i.totalCents - Number(s.paid);
  if (amount <= 0)
    throw new AppError("INVALID_TRANSITION", "This invoice is already paid.");
  if (amount < 50)
    throw new AppError(
      "NOT_ELIGIBLE",
      "Please contact the shop for balances under $0.50.",
    );
  if (amount > 99999999)
    throw new AppError(
      "NOT_ELIGIBLE",
      "Please contact the shop to arrange this payment.",
    );
  const [attempt] = await tx
    .insert(invoiceCheckout)
    .values({
      businessId: tx.businessId,
      invoiceId: i.id,
      accountId: c.accountId,
      amountCents: amount,
      expiresAt: new Date(Date.now() + 35 * 60000),
    })
    .returning();
  return attempt;
}
export async function settleCheckout(
  tx: TenantTx,
  meta: RequestMeta,
  attemptId: string,
  accountId: string,
  session: Stripe.Checkout.Session,
) {
  const [initial] = await tx
    .select()
    .from(invoiceCheckout)
    .where(
      and(
        eq(invoiceCheckout.businessId, tx.businessId),
        eq(invoiceCheckout.id, attemptId),
      ),
    );
  if (!initial) throw notFound("That checkout");
  const i = await lockInvoice(tx, initial.invoiceId);
  const [a] = await tx
    .select()
    .from(invoiceCheckout)
    .where(eq(invoiceCheckout.id, initial.id))
    .for("update");
  const pi =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (
    a.accountId !== accountId ||
    session.livemode !== stripeLivemode() ||
    session.amount_total !== a.amountCents ||
    session.currency !== a.currency ||
    session.mode !== "payment" ||
    session.metadata?.checkout_id !== a.id ||
    session.metadata?.business_id !== tx.businessId ||
    session.metadata?.invoice_id !== i.id ||
    (a.sessionId && a.sessionId !== session.id)
  )
    throw new AppError(
      "CONFLICT",
      "The Stripe payment does not match this invoice.",
    );
  if (a.status === "paid") return { paid: true };
  if (session.payment_status === "paid") {
    if (!pi)
      throw new AppError(
        "CONFLICT",
        "The Stripe payment reference is missing.",
      );
    await tx
      .update(invoiceCheckout)
      .set({
        status: "paid",
        sessionId: session.id,
        paymentIntentId: pi,
        updatedAt: new Date(),
      })
      .where(eq(invoiceCheckout.id, a.id));
    const [p] = await tx
      .insert(invoicePayment)
      .values({
        businessId: tx.businessId,
        invoiceId: i.id,
        amountCents: a.amountCents,
        method: "stripe",
        reference: pi,
        stripeAccountId: accountId,
        stripePaymentIntentId: pi,
        checkoutId: a.id,
      })
      .returning();
    await audit(tx, meta, {
      action: "invoice.stripe_payment_received",
      targetType: "invoice_payment",
      targetId: p.id,
      after: { invoiceId: i.id, amountCents: a.amountCents },
    });
    await recordActivity(tx, {
      kind: "invoice.payment_received",
      subjectType: i.vehicleId ? "vehicle" : "customer",
      subjectId: i.vehicleId ?? i.customerId,
      summary: `Online payment received for invoice #${i.number}`,
      data: { invoiceId: i.id, paymentId: p.id },
    });
    await reconcileRevenue(tx, meta, "Verified Stripe payment", i.customerId);
    return { paid: true };
  }
  // A slower request may carry an unpaid snapshot fetched before another worker
  // confirmed failure/expiry. Never reactivate that terminal reservation: a new
  // checkout may already exist, and only a verified payment can supersede it.
  if (["failed", "expired"].includes(a.status)) return { paid: false };
  // A return URL or a completed-but-unpaid session never marks an invoice paid.
  const status =
    session.status === "expired"
      ? "expired"
      : session.status === "complete"
        ? "processing"
        : "open";
  await tx
    .update(invoiceCheckout)
    .set({
      status,
      sessionId: session.id,
      paymentIntentId: pi ?? null,
      updatedAt: new Date(),
    })
    .where(eq(invoiceCheckout.id, a.id));
  return { paid: false };
}
export async function reserveRefund(
  tx: TenantTx,
  meta: RequestMeta,
  input: {
    paymentId: string;
    amountCents: number;
    reason: string;
    requestId: string;
  },
) {
  await assertOwner(tx);
  const [p] = await tx
    .select()
    .from(invoicePayment)
    .where(
      and(
        eq(invoicePayment.businessId, tx.businessId),
        eq(invoicePayment.id, input.paymentId),
      ),
    );
  if (!p || p.method !== "stripe") throw notFound("That online payment");
  await lockInvoice(tx, p.invoiceId);
  const [prior] = await tx
    .select()
    .from(invoiceRefund)
    .where(
      and(
        eq(invoiceRefund.businessId, tx.businessId),
        eq(invoiceRefund.id, input.requestId),
      ),
    );
  if (prior) {
    if (
      prior.paymentId !== p.id ||
      prior.amountCents !== input.amountCents ||
      prior.reason !== input.reason
    )
      throw new AppError("CONFLICT", "That refund request was already used.");
    return { refund: prior, payment: p };
  }
  const pending = await tx
    .select()
    .from(invoiceCheckout)
    .where(
      and(
        eq(invoiceCheckout.businessId, tx.businessId),
        eq(invoiceCheckout.invoiceId, p.invoiceId),
        inArray(invoiceCheckout.status, activeCheckoutStates),
      ),
    );
  if (pending.length)
    throw new AppError(
      "CONFLICT",
      "Reconcile the active checkout before refunding.",
    );
  const [used] = await tx
    .select({
      amount: sql<string>`coalesce(sum(${invoiceRefund.amountCents}),0)`,
    })
    .from(invoiceRefund)
    .where(
      and(
        eq(invoiceRefund.businessId, tx.businessId),
        eq(invoiceRefund.paymentId, p.id),
        inArray(invoiceRefund.status, ["creating", "pending", "succeeded"]),
      ),
    );
  if (
    !Number.isSafeInteger(input.amountCents) ||
    input.amountCents <= 0 ||
    input.amountCents > p.amountCents - Number(used.amount)
  )
    throw new AppError(
      "VALIDATION",
      "The refund exceeds the remaining payment amount.",
    );
  const [refund] = await tx
    .insert(invoiceRefund)
    .values({
      id: input.requestId,
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      invoiceId: p.invoiceId,
      paymentId: p.id,
      amountCents: input.amountCents,
      reason: input.reason,
    })
    .returning();
  await audit(tx, meta, {
    action: "invoice.refund_requested",
    targetType: "invoice_refund",
    targetId: refund.id,
    after: {
      paymentId: p.id,
      amountCents: input.amountCents,
      reason: input.reason,
    },
  });
  return { refund, payment: p };
}
export async function settleRefund(
  tx: TenantTx,
  meta: RequestMeta,
  accountId: string,
  refund: Stripe.Refund,
) {
  const paymentIntent =
    typeof refund.payment_intent === "string"
      ? refund.payment_intent
      : refund.payment_intent?.id;
  const [p] = await tx
    .select()
    .from(invoicePayment)
    .where(
      and(
        eq(invoicePayment.businessId, tx.businessId),
        eq(invoicePayment.stripeAccountId, accountId),
        eq(invoicePayment.stripePaymentIntentId, paymentIntent ?? ""),
      ),
    );
  if (!p) return false;
  const sourceInvoice = await lockInvoice(tx, p.invoiceId);
  // Dashboard-initiated refunds are imported too; provider refund ID dedupes both paths.
  const [byProvider] = await tx
    .select()
    .from(invoiceRefund)
    .where(
      and(
        eq(invoiceRefund.businessId, tx.businessId),
        eq(invoiceRefund.stripeRefundId, refund.id),
      ),
    );
  let row = byProvider;
  if (!row && refund.metadata?.refund_request_id) {
    const [requested] = await tx
      .select()
      .from(invoiceRefund)
      .where(
        and(
          eq(invoiceRefund.businessId, tx.businessId),
          eq(invoiceRefund.id, refund.metadata.refund_request_id),
        ),
      );
    row = requested;
  }
  if (
    row &&
    (row.paymentId !== p.id ||
      row.amountCents !== refund.amount ||
      (row.stripeRefundId && row.stripeRefundId !== refund.id))
  )
    throw new AppError(
      "CONFLICT",
      "Refund details do not match the recorded request.",
    );
  if (refund.currency !== "usd" || refund.amount <= 0)
    throw new AppError("CONFLICT", "Invalid refund amount or currency.");
  if (row?.status === "succeeded") return true;
  // Provider reads happen before the invoice lock. An old pending snapshot must
  // not restore a failed/canceled refund's reservation after a retry was allowed.
  if (
    row &&
    ["failed", "canceled"].includes(row.status) &&
    refund.status !== "succeeded"
  )
    return true;
  const status =
    refund.status === "succeeded"
      ? "succeeded"
      : refund.status === "failed"
        ? "failed"
        : refund.status === "canceled"
          ? "canceled"
          : "pending";
  if (!row) {
    [row] = await tx
      .insert(invoiceRefund)
      .values({
        businessId: tx.businessId,
        invoiceId: p.invoiceId,
        paymentId: p.id,
        amountCents: refund.amount,
        reason: "Refund recorded in Stripe",
        stripeRefundId: refund.id,
        status,
      })
      .returning();
  } else
    await tx
      .update(invoiceRefund)
      .set({ status, stripeRefundId: refund.id, updatedAt: new Date() })
      .where(eq(invoiceRefund.id, row.id));
  if (status === "succeeded") {
    const [entry] = await tx
      .insert(invoicePayment)
      .values({
        businessId: tx.businessId,
        invoiceId: p.invoiceId,
        amountCents: -refund.amount,
        method: "stripe_refund",
        stripeAccountId: accountId,
        stripeRefundId: refund.id,
        reversesPaymentId: p.id,
        reason: row.reason,
        reference: refund.id,
      })
      .onConflictDoNothing()
      .returning();
    if (entry)
      await audit(tx, meta, {
        action: "invoice.stripe_refunded",
        targetType: "invoice_payment",
        targetId: entry.id,
        after: { amountCents: refund.amount, paymentId: p.id },
      });
  }
  if (status === "succeeded")
    await reconcileRevenue(
      tx,
      meta,
      "Verified Stripe refund",
      sourceInvoice.customerId,
    );
  return true;
}
export async function stripeBusiness(account: string) {
  return withGlobalWorker(async (tx) => {
    const r = await tx.execute(
      sql`select app.stripe_business(${account}) as id`,
    );
    return r.rows[0]?.id as string | undefined;
  });
}
export async function withPaymentTenant<T>(
  businessId: string,
  fn: (tx: TenantTx) => Promise<T>,
) {
  return withTenant(businessId, { type: "system", id: null }, fn, {
    role: "app",
  });
}
