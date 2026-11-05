import {
  currentSubscriptionPrice,
  billingPortalConfiguration,
} from "./commercial-billing";
// Shop Revenue's own subscription billing (the shop pays us). Stripe Checkout
// collects the card and starts the trial; the Stripe Customer Portal handles card
// changes and cancellation; webhooks keep app.shop_subscription in sync.
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { shopSubscription } from "@/db/schema";
import { withAdminTenant, type InternalActor } from "@/db/admin";
import { withTenant, type Actor, type TenantTx } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import {
  billingAccess,
  billingEnabled,
  canMakeChanges,
  TRIAL_DAYS,
  type BillingAccess,
} from "@/lib/billing";
import { paymentBaseUrl, stripeClient, stripeLivemode } from "@/lib/stripe";
import { assertOwner } from "./membership";
import { withPaymentTenant } from "./payments";
import { getBusinessProfile } from "./business-profile";
import { audit, type RequestMeta } from "./records";

type Shop = { businessId: string; actor: Actor };
export type ShopSubscriptionRow = typeof shopSubscription.$inferSelect;

export async function getShopSubscription(tx: TenantTx) {
  const [row] = await tx
    .select()
    .from(shopSubscription)
    .where(eq(shopSubscription.businessId, tx.businessId));
  return row ?? null;
}

export async function shopBillingAccess(
  tx: TenantTx,
  now = new Date(),
): Promise<BillingAccess> {
  if (!billingEnabled()) return billingAccess(null, now, false);
  return billingAccess(await getShopSubscription(tx), now);
}

// Called by every shop action that changes data. Viewing, exporting, signing
// out and billing itself never go through here.
export async function assertCanMakeChanges(tx: TenantTx) {
  const access = await shopBillingAccess(tx);
  if (canMakeChanges(access)) return;
  throw new AppError(
    "NOT_ELIGIBLE",
    access.kind === "unavailable"
      ? "Subscription billing is temporarily unavailable. Please contact support."
      : access.kind === "setup"
        ? "Start your free trial in Settings → Billing to make changes."
        : "Your Shop Revenue subscription is inactive. Update billing in Settings → Billing to make changes. You can still view and export your records.",
    { billing: true },
  );
}

const LIVE_STATES = new Set([
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "paused",
  "incomplete",
]);

// Owner: start the trial (Stripe Checkout) or, if a subscription already
// exists, open the Stripe Customer Portal to update the card or cancel.
export async function startSubscription(shop: Shop, meta: RequestMeta) {
  if (!billingEnabled())
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      "Billing is not set up yet. Please try again later.",
    );
  const base = paymentBaseUrl();
  const stripe = stripeClient();
  let row = await withTenant(shop.businessId, shop.actor, async (tx) => {
    await assertOwner(tx);
    await tx
      .insert(shopSubscription)
      .values({
        businessId: tx.businessId,
        createdByUserId: tx.actor.id,
        livemode: stripeLivemode(),
      })
      .onConflictDoNothing({ target: shopSubscription.businessId });
    return (await getShopSubscription(tx))!;
  });
  if (row.livemode !== stripeLivemode())
    throw new AppError(
      "CONFLICT",
      "Billing is in the wrong payment environment.",
    );
  if (row.comped)
    throw new AppError("NOT_ELIGIBLE", "Your shop is not billed.");
  if (!row.stripeCustomerId) {
    const profile = await withTenant(shop.businessId, shop.actor, (tx) =>
      getBusinessProfile(tx),
    );
    const customer = await stripe.customers.create(
      {
        name: profile?.dba || profile?.legalName || "Repair shop",
        metadata: { business_id: shop.businessId },
      },
      { idempotencyKey: `shop-billing-customer-${row.id}` },
    );
    row = await withTenant(shop.businessId, shop.actor, async (tx) => {
      const [u] = await tx
        .update(shopSubscription)
        .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
        .where(eq(shopSubscription.businessId, tx.businessId))
        .returning();
      return u;
    });
  }
  // Reconcile before opening checkout, including canceled trials whose webhook
  // arrived late. A second click cannot grant another trial or subscription.
  await refreshShopSubscription(shop.businessId);
  row = (await withTenant(shop.businessId, shop.actor, (tx) =>
    getShopSubscription(tx),
  ))!;
  if (LIVE_STATES.has(row.status)) return openBillingPortal(shop);
  const price = await currentSubscriptionPrice(stripe);
  const attempt = await withTenant(shop.businessId, shop.actor, async (tx) => {
    await assertOwner(tx);
    const [locked] = await tx
      .select()
      .from(shopSubscription)
      .where(eq(shopSubscription.businessId, tx.businessId))
      .for("update");
    if (LIVE_STATES.has(locked.status)) return null;
    if (
      locked.checkoutAttemptId &&
      locked.checkoutExpiresAt &&
      locked.checkoutExpiresAt > new Date()
    )
      return locked;
    const [reserved] = await tx
      .update(shopSubscription)
      .set({
        checkoutAttemptId: crypto.randomUUID(),
        checkoutPriceId: price.id,
        checkoutExpiresAt: new Date(
          Math.floor(Date.now() / 1000) * 1000 + 3600000,
        ),
        updatedAt: new Date(),
      })
      .where(eq(shopSubscription.id, locked.id))
      .returning();
    return reserved;
  });
  if (!attempt) return openBillingPortal(shop);
  const trial = !attempt.trialUsedAt;
  const trackingSuffix = attempt
    .checkoutAttemptId!.replace(/-/g, "")
    .slice(-8)
    .replace(/[0-9]/g, (digit) => String.fromCharCode(97 + Number(digit)));
  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer: row.stripeCustomerId!,
      client_reference_id: shop.businessId,
      line_items: [{ price: attempt.checkoutPriceId!, quantity: 1 }],
      expires_at: Math.floor(attempt.checkoutExpiresAt!.getTime() / 1000),
      integration_identifier: `shop_revenue_billing_${trackingSuffix}`,
      payment_method_collection: "always",
      allow_promotion_codes: true,
      subscription_data: {
        metadata: { business_id: shop.businessId },
        ...(trial
          ? {
              trial_period_days: TRIAL_DAYS,
              trial_settings: {
                end_behavior: { missing_payment_method: "cancel" },
              },
            }
          : {}),
      },
      metadata: { business_id: shop.businessId },
      success_url: `${base}/app/settings/billing?started=1`,
      cancel_url: `${base}/app/settings/billing`,
    },
    { idempotencyKey: `shop-checkout-${attempt.checkoutAttemptId}` },
  );
  await withTenant(shop.businessId, shop.actor, (tx) =>
    audit(tx, meta, {
      action: "billing.checkout_started",
      targetType: "shop_subscription",
      targetId: row.id,
      after: { trial },
    }),
  );
  if (!session.url)
    throw new AppError("PROVIDER_UNAVAILABLE", "Stripe did not return a page.");
  return { url: session.url };
}

export async function openBillingPortal(shop: Shop) {
  const row = await withTenant(shop.businessId, shop.actor, async (tx) => {
    await assertOwner(tx);
    return getShopSubscription(tx);
  });
  if (!row?.stripeCustomerId)
    throw new AppError("NOT_ELIGIBLE", "Start your subscription first.");
  const stripe = stripeClient();
  const configuration = await billingPortalConfiguration(stripe);
  if (!configuration)
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      "The customer billing portal is not configured. Contact support.",
    );
  const portal = await stripe.billingPortal.sessions.create({
    configuration: configuration.id,
    customer: row.stripeCustomerId,
    return_url: `${paymentBaseUrl()}/app/settings/billing`,
  });
  return { url: portal.url };
}

const toDate = (s: number | null | undefined) =>
  s ? new Date(s * 1000) : null;

// Copies Stripe's view of the subscription onto the shop's row.
export async function syncSubscription(
  businessId: string,
  sub: Stripe.Subscription,
  meta: RequestMeta,
) {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  return withPaymentTenant(businessId, async (tx) => {
    const [row] = await tx
      .select()
      .from(shopSubscription)
      .where(eq(shopSubscription.businessId, businessId))
      .for("update");
    if (!row || row.stripeCustomerId !== customerId) return false;
    // A replaced subscription's late events must not overwrite the current one.
    if (
      row.stripeSubscriptionId &&
      row.stripeSubscriptionId !== sub.id &&
      LIVE_STATES.has(row.status) &&
      !LIVE_STATES.has(sub.status)
    )
      return false;
    const now = new Date();
    const status = sub.status;
    const periodEnd = Math.max(
      0,
      ...sub.items.data.map((i) => i.current_period_end ?? 0),
    );
    const next = {
      stripeSubscriptionId: sub.id,
      status,
      trialEndsAt: toDate(sub.trial_end),
      currentPeriodEnd: toDate(periodEnd),
      cancelAtPeriodEnd: sub.cancel_at_period_end || Boolean(sub.cancel_at),
      pastDueSince: status === "past_due" ? (row.pastDueSince ?? now) : null,
      trialUsedAt:
        row.trialUsedAt ?? (sub.trial_start ? toDate(sub.trial_start) : null),
      updatedAt: now,
      ...(row.stripeSubscriptionId !== sub.id ||
      row.status !== status ||
      (!row.trialUsedAt && sub.trial_start)
        ? {
            checkoutAttemptId: null,
            checkoutPriceId: null,
            checkoutExpiresAt: null,
          }
        : {}),
    };
    await tx
      .update(shopSubscription)
      .set(next)
      .where(eq(shopSubscription.id, row.id));
    if (row.status !== status || row.stripeSubscriptionId !== sub.id)
      await audit(tx, meta, {
        action: "billing.status_changed",
        targetType: "shop_subscription",
        targetId: row.id,
        before: { status: row.status },
        after: { status, subscriptionId: sub.id },
      });
    return true;
  });
}

export const SUBSCRIPTION_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.trial_will_end",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
];

function subscriptionIdOf(event: Stripe.Event): string | null {
  const o = event.data.object as unknown as Record<string, unknown>;
  const ref = (v: unknown) =>
    typeof v === "string"
      ? v
      : v && typeof v === "object" && "id" in v
        ? String((v as { id: string }).id)
        : null;
  if (event.type.startsWith("customer.subscription.")) return ref(o.id);
  if (event.type.startsWith("checkout.session."))
    return o.mode === "subscription" ? ref(o.subscription) : null;
  if (event.type.startsWith("invoice.")) {
    const parent = o.parent as {
      subscription_details?: { subscription?: unknown };
    } | null;
    return ref(parent?.subscription_details?.subscription);
  }
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Platform (non-Connect) Stripe events. Always re-reads the subscription from
// Stripe so out-of-order or replayed events converge on the current state.
export async function applySubscriptionEvent(event: Stripe.Event) {
  if (event.account || !SUBSCRIPTION_EVENTS.includes(event.type)) return false;
  const id = subscriptionIdOf(event);
  if (!id) return false;
  if (event.livemode !== stripeLivemode())
    throw new AppError(
      "CONFLICT",
      "Stripe webhook mode does not match this environment.",
    );
  const sub = await stripeClient().subscriptions.retrieve(id);
  const businessId = sub.metadata?.business_id;
  if (!businessId || !UUID.test(businessId)) return false;
  return syncSubscription(businessId, sub, {
    requestId: event.id,
    ip: null,
  });
}

// After Checkout returns, pull the newest subscription so the page is correct
// even if the webhook has not arrived yet.
export async function refreshShopSubscription(businessId: string) {
  if (!billingEnabled()) return false;
  const row = await withPaymentTenant(businessId, (tx) =>
    getShopSubscription(tx),
  );
  if (!row?.stripeCustomerId) return false;
  const list = await stripeClient().subscriptions.list({
    customer: row.stripeCustomerId,
    status: "all",
    limit: 1,
  });
  const sub = list.data[0];
  if (!sub) return false;
  return syncSubscription(businessId, sub, {
    requestId: `refresh-${sub.id}`,
    ip: null,
  });
}

// Internal staff: give a shop free access (pilots, friends, your own shops).
export async function setShopComped(
  actor: InternalActor,
  meta: RequestMeta,
  input: { businessId: string; comped: boolean; reason: string },
) {
  return withAdminTenant(input.businessId, actor, async (tx) => {
    let row = await getShopSubscription(tx);
    if (!row)
      [row] = await tx
        .insert(shopSubscription)
        .values({ businessId: tx.businessId, livemode: stripeLivemode() })
        .returning();
    await tx
      .update(shopSubscription)
      .set({
        comped: input.comped,
        compedReason: input.comped ? input.reason : null,
        updatedAt: new Date(),
      })
      .where(eq(shopSubscription.id, row.id));
    await audit(tx, meta, {
      action: "billing.comped_changed",
      targetType: "shop_subscription",
      targetId: row.id,
      before: { comped: row.comped },
      after: { comped: input.comped, reason: input.reason },
    });
    return { comped: input.comped };
  });
}

// "$149/month" from the configured Stripe price, or null if unavailable.
export async function subscriptionPriceLabel(subscriptionId?: string) {
  if (!billingEnabled()) return null;
  try {
    const stripe = stripeClient();
    const p = subscriptionId
      ? (await stripe.subscriptions.retrieve(subscriptionId)).items.data[0]
          ?.price
      : await currentSubscriptionPrice(stripe);
    if (!p) return null;
    if (p.unit_amount == null) return null;
    const amount = (p.unit_amount / 100).toLocaleString("en-US", {
      style: "currency",
      currency: p.currency.toUpperCase(),
      minimumFractionDigits: p.unit_amount % 100 ? 2 : 0,
    });
    const every = p.recurring?.interval ?? "month";
    return `${amount}/${every}`;
  } catch {
    return null;
  }
}
