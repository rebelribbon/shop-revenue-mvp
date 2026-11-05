import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type Stripe from "stripe";
import { withAdmin, type InternalActor } from "@/db/admin";
import { internalUser } from "@/db/schema";
import { MONTHLY_PRICE_CENTS } from "@/lib/billing";
import { AppError } from "@/lib/errors";
import { paymentBaseUrl, stripeClient } from "@/lib/stripe";
import { auditPlatform, type RequestMeta } from "./records";

export const SUBSCRIPTION_LOOKUP_KEY = "shop_revenue_monthly";
const PRODUCT_ID = "prod_shop_revenue_subscription";
export async function currentSubscriptionPrice(
  stripe: Stripe = stripeClient(),
) {
  const prices = await stripe.prices.list({
    active: true,
    lookup_keys: [SUBSCRIPTION_LOOKUP_KEY],
    limit: 1,
  });
  const price =
    prices.data[0] ??
    (process.env.STRIPE_SUBSCRIPTION_PRICE_ID
      ? await stripe.prices.retrieve(process.env.STRIPE_SUBSCRIPTION_PRICE_ID)
      : null);
  if (
    !price?.active ||
    price.type !== "recurring" ||
    price.currency !== "usd" ||
    price.recurring?.interval !== "month" ||
    price.recurring.interval_count !== 1 ||
    price.unit_amount !== MONTHLY_PRICE_CENTS
  )
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      "The $49.99 monthly subscription price is not configured.",
    );
  return price;
}
async function requireAdmin(actor: InternalActor) {
  const [me] = await withAdmin(actor, (tx) =>
    tx
      .select()
      .from(internalUser)
      .where(
        and(
          eq(internalUser.id, actor.internalUserId),
          eq(internalUser.role, "admin"),
          eq(internalUser.active, true),
        ),
      ),
  );
  if (!me) throw new AppError("FORBIDDEN", "Admins only.");
}

export async function billingPortalConfiguration(stripe: Stripe) {
  const configs = await stripe.billingPortal.configurations.list({
    limit: 100,
  });
  return (
    configs.data.find(
      (c) => c.active && c.metadata?.application === "shop_revenue",
    ) ?? null
  );
}

export async function configureSubscriptionPlan(
  actor: InternalActor,
  meta: RequestMeta,
  requestId: string,
) {
  await requireAdmin(actor);
  const amount = MONTHLY_PRICE_CENTS;
  const stripe = stripeClient();
  try {
    await stripe.products.retrieve(PRODUCT_ID);
  } catch (error) {
    if ((error as { code?: string }).code !== "resource_missing") throw error;
    await stripe.products.create(
      {
        id: PRODUCT_ID,
        name: "Shop Revenue",
        description: "Monthly subscription for one repair shop",
        metadata: { application: "shop_revenue" },
      },
      { idempotencyKey: "shop-revenue-product-v1" },
    );
  }
  if (!(await billingPortalConfiguration(stripe)))
    await stripe.billingPortal.configurations.create(
      {
        business_profile: { headline: "Manage your Shop Revenue subscription" },
        default_return_url: `${paymentBaseUrl()}/app/settings/billing`,
        features: {
          invoice_history: { enabled: true },
          payment_method_update: { enabled: true },
          subscription_cancel: { enabled: true, mode: "at_period_end" },
        },
        metadata: { application: "shop_revenue" },
      },
      { idempotencyKey: "shop-revenue-portal-v1" },
    );
  const price = await stripe.prices.create(
    {
      product: PRODUCT_ID,
      currency: "usd",
      unit_amount: amount,
      recurring: { interval: "month" },
      tax_behavior: "exclusive",
      lookup_key: SUBSCRIPTION_LOOKUP_KEY,
      transfer_lookup_key: true,
      metadata: {
        application: "shop_revenue",
        pricing_model: "fixed_monthly",
      },
    },
    { idempotencyKey: `shop-plan-${requestId}` },
  );
  await withAdmin(actor, (tx) =>
    auditPlatform(
      tx,
      meta,
      { type: "internal", id: actor.internalUserId },
      {
        action: "billing.plan_configured",
        targetType: "stripe_price",
        targetId: null,
        after: {
          stripePriceId: price.id,
          monthlyPriceCents: amount,
          appliesTo: "new_subscriptions",
        },
      },
    ),
  );
  return {
    priceId: price.id,
    monthlyPriceCents: amount,
    message: `Subscription price set to $${(amount / 100).toFixed(2)} per shop per month.`,
  };
}

export const discountCodeInput = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{3,40}$/),
  percentOff: z.coerce.number().int().min(1).max(100),
  duration: z.enum(["once", "forever"]),
  maxRedemptions: z.coerce.number().int().min(1).max(100000),
  expiresOn: z.string().regex(/^20\d{2}-\d{2}-\d{2}$/),
});
export async function createDiscountCode(
  actor: InternalActor,
  meta: RequestMeta,
  raw: z.infer<typeof discountCodeInput>,
  requestId: string,
) {
  await requireAdmin(actor);
  const input = discountCodeInput.parse(raw);
  const expires = new Date(input.expiresOn + "T23:59:59Z");
  if (
    Number.isNaN(expires.getTime()) ||
    expires.toISOString().slice(0, 10) !== input.expiresOn ||
    expires.getTime() <= Date.now()
  )
    throw new AppError("VALIDATION", "Choose a future expiration date.");
  const stripe = stripeClient();
  const price = await currentSubscriptionPrice(stripe);
  const product =
    typeof price.product === "string" ? price.product : price.product.id;
  const coupon = await stripe.coupons.create(
    {
      name: `Shop Revenue ${input.code}`,
      percent_off: input.percentOff,
      duration: input.duration,
      applies_to: { products: [product] },
      metadata: { application: "shop_revenue" },
    },
    { idempotencyKey: `shop-coupon-${requestId}` },
  );
  const promo = await stripe.promotionCodes.create(
    {
      code: input.code,
      promotion: { type: "coupon", coupon: coupon.id },
      max_redemptions: input.maxRedemptions,
      expires_at: Math.floor(expires.getTime() / 1000),
      metadata: { application: "shop_revenue" },
    },
    { idempotencyKey: `shop-promo-${requestId}` },
  );
  await withAdmin(actor, (tx) =>
    auditPlatform(
      tx,
      meta,
      { type: "internal", id: actor.internalUserId },
      {
        action: "billing.discount_created",
        targetType: "stripe_promotion_code",
        targetId: null,
        after: { ...input, stripePromotionCodeId: promo.id },
      },
    ),
  );
  return {
    code: input.code,
    message: `${input.code} is ready to use at checkout.`,
  };
}
