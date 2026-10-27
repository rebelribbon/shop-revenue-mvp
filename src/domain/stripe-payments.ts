import { and, desc, eq, inArray } from "drizzle-orm";
import type Stripe from "stripe";
import {
  invoiceCheckout,
  invoicePayment,
  invoiceRefund,
  stripeConnection,
} from "@/db/schema";
import { withTenant, type Actor } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import { paymentBaseUrl, stripeClient, stripeLivemode } from "@/lib/stripe";
import {
  getStripeConnection,
  prepareStripeConnection,
  reserveCheckout,
  reserveRefund,
  resolveInvoicePaymentToken,
  settleCheckout,
  settleRefund,
  stripeBusiness,
  withPaymentTenant,
  activeCheckoutStates,
} from "./payments";
import { audit, type RequestMeta } from "./records";
import { getBusinessProfile } from "./business-profile";

type Shop = { businessId: string; actor: Actor };
const requireMode = (mode: boolean) => {
  if (mode !== stripeLivemode())
    throw new AppError(
      "CONFLICT",
      "Stripe account is in the wrong payment environment.",
    );
};
export async function connectShop(shop: Shop, meta: RequestMeta) {
  const base = paymentBaseUrl();
  const stripe = stripeClient();
  const row = await withTenant(shop.businessId, shop.actor, (tx) =>
    prepareStripeConnection(tx),
  );
  requireMode(row.livemode);
  let accountId = row.accountId;
  if (!accountId) {
    const profile = await withTenant(shop.businessId, shop.actor, (tx) =>
      getBusinessProfile(tx),
    );
    const account = await stripe.v2.core.accounts.create(
      {
        display_name: profile?.dba || profile?.legalName || "Repair shop",
        dashboard: "full",
        identity: { country: "us" },
        defaults: {
          currency: "usd",
          responsibilities: {
            fees_collector: "stripe",
            losses_collector: "stripe",
          },
        },
        configuration: {
          merchant: { capabilities: { card_payments: { requested: true } } },
        },
        include: ["configuration.merchant"],
        metadata: { business_id: shop.businessId },
      },
      { idempotencyKey: `shop-connect-${row.id}` },
    );
    accountId = account.id;
    await withTenant(shop.businessId, shop.actor, async (tx) => {
      await tx
        .update(stripeConnection)
        .set({ accountId, updatedAt: new Date() })
        .where(
          and(
            eq(stripeConnection.businessId, tx.businessId),
            eq(stripeConnection.id, row.id),
          ),
        );
      await audit(tx, meta, {
        action: "stripe.account_connected",
        targetType: "stripe_connection",
        targetId: row.id,
        after: { accountId },
      });
    });
  }
  const link = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        return_url: `${base}/app/settings/payments?returned=1`,
        refresh_url: `${base}/app/settings/payments?refresh=1`,
      },
    },
  });
  return { url: link.url };
}
export async function refreshShopConnection(businessId: string) {
  const c = await withPaymentTenant(businessId, (tx) =>
    getStripeConnection(tx),
  );
  if (!c?.accountId) return null;
  requireMode(c.livemode);
  const account = await stripeClient().v2.core.accounts.retrieve(c.accountId, {
    include: ["configuration.merchant"],
  });
  const status =
    account.configuration?.merchant?.capabilities?.card_payments?.status ??
    "inactive";
  await withPaymentTenant(businessId, (tx) =>
    tx
      .update(stripeConnection)
      .set({ cardPaymentsStatus: status, updatedAt: new Date() })
      .where(eq(stripeConnection.businessId, businessId)),
  );
  return { ...c, cardPaymentsStatus: status };
}
export async function beginInvoiceCheckout(token: string, meta: RequestMeta) {
  const base = paymentBaseUrl();
  if (!process.env.STRIPE_WEBHOOK_SECRET)
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      "Online payment confirmation is not configured yet.",
    );
  const context = await resolveInvoicePaymentToken(token);
  await refreshShopConnection(context.businessId);
  const a = await withPaymentTenant(context.businessId, (tx) =>
    reserveCheckout(tx, context.invoiceId),
  );
  const stripe = stripeClient();
  let session: Stripe.Checkout.Session;
  if (a.sessionId)
    session = await stripe.checkout.sessions.retrieve(
      a.sessionId,
      {},
      { stripeAccount: a.accountId },
    );
  else {
    if (Date.now() - a.createdAt.getTime() > 23 * 3600000)
      throw new AppError(
        "CONFLICT",
        "The shop needs to reconcile an earlier checkout attempt.",
      );
    session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: a.currency,
              unit_amount: a.amountCents,
              product_data: { name: "Repair invoice payment" },
            },
            quantity: 1,
          },
        ],
        metadata: {
          checkout_id: a.id,
          invoice_id: a.invoiceId,
          business_id: a.businessId,
        },
        payment_intent_data: {
          metadata: {
            checkout_id: a.id,
            invoice_id: a.invoiceId,
            business_id: a.businessId,
          },
        },
        integration_identifier: "shop_revenue_kqjvmbxz",
        expires_at: Math.floor(a.expiresAt.getTime() / 1000),
        success_url: `${base}/invoice/${token}?payment=processing`,
        cancel_url: `${base}/invoice/${token}?payment=canceled`,
      },
      {
        stripeAccount: a.accountId,
        idempotencyKey: `invoice-checkout-${a.id}`,
      },
    );
  }
  const result = await withPaymentTenant(a.businessId, (tx) =>
    settleCheckout(tx, meta, a.id, a.accountId, session),
  );
  if (result.paid) return { paid: true as const };
  if (session.status !== "open" || !session.url)
    throw new AppError(
      "CONFLICT",
      session.status === "expired"
        ? "That checkout expired. Please try the Pay button again."
        : "Your payment is processing. Refresh this invoice shortly.",
    );
  return { url: session.url };
}
export async function requestStripeRefund(
  shop: Shop,
  meta: RequestMeta,
  input: {
    paymentId: string;
    amountCents: number;
    reason: string;
    requestId: string;
  },
) {
  const { refund, payment } = await withTenant(
    shop.businessId,
    shop.actor,
    (tx) => reserveRefund(tx, meta, input),
  );
  const stripe = stripeClient();
  let result: Stripe.Refund;
  if (refund.stripeRefundId)
    result = await stripe.refunds.retrieve(
      refund.stripeRefundId,
      {},
      { stripeAccount: payment.stripeAccountId! },
    );
  else {
    if (Date.now() - refund.createdAt.getTime() > 23 * 3600000)
      throw new AppError(
        "CONFLICT",
        "Reconcile the earlier refund before trying again.",
      );
    result = await stripe.refunds.create(
      {
        payment_intent: payment.stripePaymentIntentId!,
        amount: refund.amountCents,
        metadata: {
          refund_request_id: refund.id,
          business_id: shop.businessId,
        },
      },
      {
        stripeAccount: payment.stripeAccountId!,
        idempotencyKey: `invoice-refund-${refund.id}`,
      },
    );
  }
  await withPaymentTenant(shop.businessId, (tx) =>
    settleRefund(tx, meta, payment.stripeAccountId!, result),
  );
  return { id: refund.id, status: result.status };
}
async function applySession(
  businessId: string,
  account: string,
  session: Stripe.Checkout.Session,
  meta: RequestMeta,
) {
  const id = session.metadata?.checkout_id;
  if (!id) return false;
  await withPaymentTenant(businessId, (tx) =>
    settleCheckout(tx, meta, id, account, session),
  );
  return true;
}
async function importRefund(
  businessId: string,
  account: string,
  refund: Stripe.Refund,
  meta: RequestMeta,
) {
  const stripe = stripeClient();
  const pi =
    typeof refund.payment_intent === "string"
      ? refund.payment_intent
      : refund.payment_intent?.id;
  if (!pi) return false;
  // Stripe can deliver a refund before the Checkout webhook. Settle the original
  // payment first, using Stripe's current session rather than event arrival order.
  const sessions = await stripe.checkout.sessions.list(
    { payment_intent: pi, limit: 100 },
    { stripeAccount: account },
  );
  for (const session of sessions.data)
    if (session.metadata?.checkout_id)
      await applySession(businessId, account, session, meta);
  return withPaymentTenant(businessId, (tx) =>
    settleRefund(tx, meta, account, refund),
  );
}
export async function applyStripeEvent(event: Stripe.Event) {
  if (
    ![
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
      "refund.created",
      "refund.updated",
      "refund.failed",
      "account.updated",
    ].includes(event.type)
  )
    return false;
  if (!event.account) return false;
  const businessId = await stripeBusiness(event.account);
  if (!businessId) return false;
  if (event.livemode !== stripeLivemode())
    throw new AppError(
      "CONFLICT",
      "Stripe webhook mode does not match this environment.",
    );
  const stripe = stripeClient();
  const meta = { requestId: event.id, ip: null };
  if (
    [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.expired",
      "checkout.session.async_payment_failed",
    ].includes(event.type)
  ) {
    const raw = event.data.object as Stripe.Checkout.Session;
    const session = await stripe.checkout.sessions.retrieve(
      raw.id,
      {},
      { stripeAccount: event.account },
    );
    const applied = await applySession(
      businessId,
      event.account,
      session,
      meta,
    );
    if (
      event.type === "checkout.session.async_payment_failed" &&
      session.payment_status !== "paid" &&
      session.metadata?.checkout_id
    ) {
      await withPaymentTenant(businessId, async (tx) => {
        const [a] = await tx
          .select()
          .from(invoiceCheckout)
          .where(
            and(
              eq(invoiceCheckout.businessId, businessId),
              eq(invoiceCheckout.id, session.metadata!.checkout_id),
            ),
          );
        if (a) {
          await tx
            .update(invoiceCheckout)
            .set({ status: "failed", updatedAt: new Date() })
            .where(
              and(
                eq(invoiceCheckout.id, a.id),
                inArray(invoiceCheckout.status, ["processing", "open"]),
              ),
            );
        }
      });
    }
    return applied;
  }
  if (
    ["refund.created", "refund.updated", "refund.failed"].includes(event.type)
  ) {
    const raw = event.data.object as Stripe.Refund;
    const refund = await stripe.refunds.retrieve(
      raw.id,
      {},
      { stripeAccount: event.account },
    );
    return importRefund(businessId, event.account, refund, meta);
  }
  if (event.type === "account.updated") {
    await refreshShopConnection(businessId);
    return true;
  }
  return false;
}
export async function reconcileShopPayments(
  businessId: string,
  meta: RequestMeta,
) {
  const stripe = stripeClient();
  await refreshShopConnection(businessId);
  const data = await withPaymentTenant(businessId, async (tx) => ({
    checkouts: await tx
      .select()
      .from(invoiceCheckout)
      .where(
        and(
          eq(invoiceCheckout.businessId, businessId),
          inArray(invoiceCheckout.status, activeCheckoutStates),
        ),
      ),
    refunds: await tx
      .select()
      .from(invoiceRefund)
      .where(
        and(
          eq(invoiceRefund.businessId, businessId),
          inArray(invoiceRefund.status, ["creating", "pending"]),
        ),
      ),
    payments: await tx
      .select()
      .from(invoicePayment)
      .where(
        and(
          eq(invoicePayment.businessId, businessId),
          eq(invoicePayment.method, "stripe"),
        ),
      )
      .orderBy(desc(invoicePayment.createdAt))
      .limit(100),
    connection: await getStripeConnection(tx),
  }));
  let checked = 0;
  for (const a of data.checkouts) {
    let session: Stripe.Checkout.Session | undefined;
    if (a.sessionId)
      session = await stripe.checkout.sessions.retrieve(
        a.sessionId,
        {},
        { stripeAccount: a.accountId },
      );
    else {
      for await (const candidate of stripe.checkout.sessions.list(
        {
          limit: 100,
          created: { gte: Math.floor(a.createdAt.getTime() / 1000) - 60 },
        },
        { stripeAccount: a.accountId },
      )) {
        if (candidate.metadata?.checkout_id === a.id) {
          session = candidate;
          break;
        }
      }
    }
    if (session) {
      await applySession(businessId, a.accountId, session, meta);
      checked++;
    }
  }
  if (data.connection?.accountId) {
    for (const r of data.refunds) {
      if (r.stripeRefundId) {
        await importRefund(
          businessId,
          data.connection.accountId,
          await stripe.refunds.retrieve(
            r.stripeRefundId,
            {},
            { stripeAccount: data.connection.accountId },
          ),
          meta,
        );
        checked++;
      } else {
        const [p] = await withPaymentTenant(businessId, (tx) =>
          tx
            .select()
            .from(invoicePayment)
            .where(eq(invoicePayment.id, r.paymentId)),
        );
        if (p?.stripePaymentIntentId) {
          for await (const candidate of stripe.refunds.list(
            { payment_intent: p.stripePaymentIntentId, limit: 100 },
            { stripeAccount: data.connection.accountId },
          )) {
            if (candidate.metadata?.refund_request_id === r.id) {
              await importRefund(
                businessId,
                data.connection.accountId,
                candidate,
                meta,
              );
              checked++;
              break;
            }
          }
        }
      }
    }
  }
  // Recover refunds initiated in Stripe even if every refund webhook was lost.
  for (const p of data.payments) {
    if (!p.stripePaymentIntentId || !p.stripeAccountId) continue;
    for await (const refund of stripe.refunds.list(
      { payment_intent: p.stripePaymentIntentId, limit: 100 },
      { stripeAccount: p.stripeAccountId },
    )) {
      await importRefund(businessId, p.stripeAccountId, refund, meta);
      checked++;
    }
  }
  return { checked };
}

export async function cancelInvoiceCheckout(
  shop: Shop,
  meta: RequestMeta,
  id: string,
) {
  const { assertOwner } = await import("./membership");
  const a = await withTenant(shop.businessId, shop.actor, async (tx) => {
    await assertOwner(tx);
    const [row] = await tx
      .select()
      .from(invoiceCheckout)
      .where(
        and(
          eq(invoiceCheckout.businessId, tx.businessId),
          eq(invoiceCheckout.id, id),
        ),
      );
    if (!row) throw new AppError("NOT_FOUND", "That checkout was not found.");
    return row;
  });
  if (!activeCheckoutStates.includes(a.status))
    return { message: "This checkout is already closed." };
  if (!a.sessionId)
    throw new AppError(
      "CONFLICT",
      "Refresh payment status first to locate this checkout in Stripe.",
    );
  const stripe = stripeClient();
  let session = await stripe.checkout.sessions.retrieve(
    a.sessionId,
    {},
    { stripeAccount: a.accountId },
  );
  if (session.status === "open")
    session = await stripe.checkout.sessions.expire(
      session.id,
      {},
      { stripeAccount: a.accountId },
    );
  await applySession(shop.businessId, a.accountId, session, meta);
  if (session.payment_status === "paid")
    return {
      message:
        "Stripe confirmed payment before cancellation. The payment has been recorded.",
    };
  if (session.status !== "expired")
    throw new AppError(
      "CONFLICT",
      "This payment is already processing and cannot be canceled here.",
    );
  await withTenant(shop.businessId, shop.actor, (tx) =>
    audit(tx, meta, {
      action: "invoice.checkout_canceled",
      targetType: "invoice_checkout",
      targetId: id,
    }),
  );
  return {
    message:
      "Unpaid checkout canceled. You can record a manual payment or let the customer start a fresh checkout.",
  };
}
