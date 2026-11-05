import { and, eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { auditEvent, shopSubscription } from "@/db/schema";
import { withGlobalWorker } from "@/db/tenant";
import { stripeClient, stripeLivemode } from "@/lib/stripe";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { withPaymentTenant } from "./payments";
import { audit } from "./records";

export const BILLING_RISK_EVENTS = [
  "charge.dispute.created",
  "charge.refunded",
  "radar.early_fraud_warning.created",
];
// These events require review, not automatic cancellation. Resolve ownership
// through the charge's Stripe Customer, which is uniquely bound to a shop.
export async function applyBillingRiskEvent(event: Stripe.Event) {
  if (event.account || !BILLING_RISK_EVENTS.includes(event.type)) return false;
  if (event.livemode !== stripeLivemode())
    throw new AppError("CONFLICT", "Stripe event mode does not match.");
  const object = event.data.object as unknown as {
    charge?: string | Stripe.Charge;
  };
  const charge =
    event.type === "charge.refunded"
      ? (event.data.object as Stripe.Charge)
      : typeof object.charge === "string"
        ? await stripeClient().charges.retrieve(object.charge)
        : object.charge;
  const customer =
    typeof charge?.customer === "string"
      ? charge.customer
      : charge?.customer?.id;
  if (!customer || !charge) return false;
  const businessId = await withGlobalWorker(async (tx) => {
    const result = await tx.execute(
      sql`select app.billing_customer_business(${customer}) as id`,
    );
    return result.rows[0]?.id as string | undefined;
  });
  if (!businessId) return false;
  return withPaymentTenant(businessId, async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"billing-risk:" + event.id},0))`,
    );
    const action = "billing.risk_reported";
    const [prior] = await tx
      .select({ id: auditEvent.id })
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.businessId, businessId),
          eq(auditEvent.requestId, event.id),
          eq(auditEvent.action, action),
        ),
      );
    if (prior) return true;
    const [subscription] = await tx
      .select({
        id: shopSubscription.id,
        stripeId: shopSubscription.stripeSubscriptionId,
      })
      .from(shopSubscription)
      .where(eq(shopSubscription.businessId, businessId));
    await audit(
      tx,
      { requestId: event.id },
      {
        action,
        targetType: "shop_subscription",
        targetId: subscription?.id ?? null,
        after: {
          eventType: event.type,
          customerId: customer,
          currentSubscriptionId: subscription?.stripeId,
          stripeChargeId: charge.id,
          amountCents: charge.amount,
          refundedCents: charge.amount_refunded,
          currency: charge.currency,
          reviewRequired: true,
        },
      },
    );
    logger.warn({
      event: "billing.payment_risk",
      businessId,
      stripeEventId: event.id,
      eventType: event.type,
      alert: true,
    });
    return true;
  });
}
