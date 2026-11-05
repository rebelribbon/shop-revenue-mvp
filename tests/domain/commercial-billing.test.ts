import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import Stripe from "stripe";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { auditEvent, shopSubscription } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  configureSubscriptionPlan,
  createDiscountCode,
} from "@/domain/commercial-billing";
import { startSubscription, syncSubscription } from "@/domain/billing";
import { applyBillingRiskEvent } from "@/domain/billing-risk";
import {
  billingAccess,
  canMakeChanges,
  subscriptionPriceFromCosts,
} from "@/lib/billing";
import { createInternalUser, meta, seedTenant } from "../helpers/fixtures";

let client: Stripe;
vi.mock("@/lib/stripe", async (original) => ({
  ...(await original<typeof import("@/lib/stripe")>()),
  stripeClient: () => client,
}));
const price = {
  id: "price_monthly",
  product: "prod_shop_revenue_subscription",
  active: true,
  type: "recurring",
  unit_amount: 15000,
  currency: "usd",
  recurring: { interval: "month", interval_count: 1 },
};
function provider() {
  return {
    products: {
      retrieve: vi.fn(async () => ({ id: price.product })),
      create: vi.fn(async () => ({ id: price.product })),
    },
    prices: {
      list: vi.fn(async () => ({ data: [price] })),
      retrieve: vi.fn(async () => price),
      create: vi.fn(async () => ({ ...price, id: "price_new" })),
    },
    customers: {
      create: vi.fn(async (p: { metadata: { business_id: string } }) => ({
        id: `cus_${p.metadata.business_id}`,
      })),
    },
    subscriptions: {
      list: vi.fn<(...a: unknown[]) => Promise<{ data: unknown[] }>>(
        async () => ({ data: [] }),
      ),
    },
    checkout: {
      sessions: {
        create: vi.fn(async () => ({
          id: "cs_reserved",
          url: "https://checkout.stripe.com/c/pay/cs_reserved",
        })),
      },
    },
    billingPortal: {
      configurations: {
        list: vi.fn(async () => ({
          data: [
            {
              id: "bpc_shop",
              active: true,
              metadata: { application: "shop_revenue" },
            },
          ],
        })),
        create: vi.fn(async () => ({ id: "bpc_shop" })),
      },
      sessions: {
        create: vi.fn(async () => ({
          url: "https://billing.stripe.com/p/session/test",
        })),
      },
    },
    coupons: { create: vi.fn(async () => ({ id: "coupon_shop" })) },
    promotionCodes: { create: vi.fn(async () => ({ id: "promo_shop" })) },
    charges: { retrieve: vi.fn() },
  };
}
let fake: ReturnType<typeof provider>;
let saved: Record<string, string | undefined>;
const keys = [
  "APP_ENV",
  "STRIPE_SECRET_KEY",
  "STRIPE_BILLING_WEBHOOK_SECRET",
  "STRIPE_SUBSCRIPTION_PRICE_ID",
  "STRIPE_SUBSCRIPTION_LOOKUP_KEY",
  "PAYMENTS_BASE_URL",
];
beforeEach(() => {
  saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    APP_ENV: "test",
    STRIPE_SUBSCRIPTION_LOOKUP_KEY: "shop_revenue_monthly",
    STRIPE_SECRET_KEY: "sk_test_synthetic",
    STRIPE_BILLING_WEBHOOK_SECRET: "whsec_synthetic",
    PAYMENTS_BASE_URL: "https://billing.example.test",
  });
  fake = provider();
  client = fake as unknown as Stripe;
});
afterEach(() => {
  for (const k of keys)
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

it("sets each shop's price to three times total monthly operating costs", async () => {
  expect(subscriptionPriceFromCosts(5000)).toBe(15000);
  for (const n of [0, -1, 1.5, 10000001])
    expect(() => subscriptionPriceFromCosts(n)).toThrow();
  const admin = await createInternalUser("admin");
  await configureSubscriptionPlan(
    { internalUserId: admin.id },
    meta(),
    5000,
    randomUUID(),
  );
  expect(fake.prices.create).toHaveBeenCalledWith(
    expect.objectContaining({
      unit_amount: 15000,
      currency: "usd",
      recurring: { interval: "month" },
      lookup_key: "shop_revenue_monthly",
      metadata: expect.objectContaining({
        monthly_operating_cost_cents: "5000",
        pricing_multiplier: "3",
      }),
    }),
    expect.anything(),
  );
  const support = await createInternalUser("support");
  await expect(
    configureSubscriptionPlan(
      { internalUserId: support.id },
      meta(),
      5000,
      randomUUID(),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("scopes discount codes to the SaaS product with expiry and redemption limits", async () => {
  const admin = await createInternalUser("admin");
  const future = new Date(Date.now() + 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  await createDiscountCode(
    { internalUserId: admin.id },
    meta(),
    {
      code: "launch-20",
      percentOff: 20,
      duration: "once",
      maxRedemptions: 10,
      expiresOn: future,
    },
    randomUUID(),
  );
  expect(fake.coupons.create).toHaveBeenCalledWith(
    expect.objectContaining({
      percent_off: 20,
      duration: "once",
      applies_to: { products: [price.product] },
    }),
    expect.anything(),
  );
  expect(fake.promotionCodes.create).toHaveBeenCalledWith(
    expect.objectContaining({
      code: "LAUNCH-20",
      promotion: { type: "coupon", coupon: "coupon_shop" },
      max_redemptions: 10,
      expires_at: expect.any(Number),
    }),
    expect.anything(),
  );
  await expect(
    createDiscountCode(
      { internalUserId: admin.id },
      meta(),
      {
        code: "BAD",
        percentOff: 101,
        duration: "forever",
        maxRedemptions: 1,
        expiresOn: future,
      },
      randomUUID(),
    ),
  ).rejects.toThrow();
});

it("reuses a persisted Stripe idempotency key for simultaneous trial checkout starts", async () => {
  const t = await seedTenant("Checkout retries");
  const shop = { businessId: t.businessId, actor: t.owner.actor };
  await Promise.all([
    startSubscription(shop, meta()),
    startSubscription(shop, meta()),
  ]);
  const calls = fake.checkout.sessions.create.mock.calls as unknown as [
    Stripe.Checkout.SessionCreateParams,
    Stripe.RequestOptions,
  ][];
  expect(calls).toHaveLength(2);
  expect(calls[0][1].idempotencyKey).toBe(calls[1][1].idempotencyKey);
  expect(calls[0][0]).toEqual(calls[1][0]);
  expect(calls[0][0]).toMatchObject({
    mode: "subscription",
    allow_promotion_codes: true,
    payment_method_collection: "always",
    subscription_data: { trial_period_days: 14 },
    line_items: [{ price: price.id, quantity: 1 }],
  });
  expect(calls[0][0]).not.toHaveProperty("payment_method_types");
  expect(calls[0][0].integration_identifier).toMatch(
    /^shop_revenue_billing_[a-z]{8}$/,
  );
  const before = calls.length;
  fake.subscriptions.list.mockResolvedValue({
    data: [
      {
        id: "sub_existing",
        customer: `cus_${t.businessId}`,
        status: "trialing",
        trial_start: Math.floor(Date.now() / 1000),
        trial_end: Math.floor(Date.now() / 1000) + 14 * 86400,
        metadata: { business_id: t.businessId },
        items: {
          data: [
            { current_period_end: Math.floor(Date.now() / 1000) + 14 * 86400 },
          ],
        },
        cancel_at_period_end: false,
      },
    ],
  });
  await startSubscription(shop, meta());
  expect(fake.checkout.sessions.create).toHaveBeenCalledTimes(before);
  expect(fake.billingPortal.sessions.create).toHaveBeenCalled();
  const completed = (await fake.subscriptions.list())
    .data[0] as Stripe.Subscription;
  const canceled = { ...completed, status: "canceled" } as Stripe.Subscription;
  await syncSubscription(t.businessId, canceled, meta());
  fake.subscriptions.list.mockResolvedValue({ data: [canceled] });
  await startSubscription(shop, meta());
  const restarted = fake.checkout.sessions.create.mock.calls as unknown as [
    Stripe.Checkout.SessionCreateParams,
    Stripe.RequestOptions,
  ][];
  expect(restarted).toHaveLength(before + 1);
  expect(restarted.at(-1)![1].idempotencyKey).not.toBe(
    restarted[0][1].idempotencyKey,
  );
  expect(restarted.at(-1)![0].subscription_data).not.toHaveProperty(
    "trial_period_days",
  );
});

it("records refund/dispute/fraud review once using the charge Customer and rejects the wrong payment mode", async () => {
  const t = await seedTenant("Subscription refund");
  await startSubscription(
    { businessId: t.businessId, actor: t.owner.actor },
    meta(),
  );
  const event = {
    id: `evt_${randomUUID()}`,
    type: "charge.refunded",
    livemode: false,
    data: {
      object: {
        id: "ch_subscription",
        customer: `cus_${t.businessId}`,
        amount: 15000,
        amount_refunded: 15000,
        currency: "usd",
      },
    },
  } as unknown as Stripe.Event;
  expect(await applyBillingRiskEvent(event)).toBe(true);
  expect(await applyBillingRiskEvent(event)).toBe(true);
  const rows = await withTenant(t.businessId, t.owner.actor, (tx) =>
    tx
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.requestId, event.id),
          eq(auditEvent.action, "billing.risk_reported"),
        ),
      ),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].after).toMatchObject({
    refundedCents: 15000,
    reviewRequired: true,
  });
  fake.charges.retrieve.mockResolvedValue(event.data.object);
  for (const type of [
    "charge.dispute.created",
    "radar.early_fraud_warning.created",
  ]) {
    const risk = {
      ...event,
      id: `evt_${randomUUID()}`,
      type,
      data: { object: { charge: "ch_subscription" } },
    } as unknown as Stripe.Event;
    expect(await applyBillingRiskEvent(risk)).toBe(true);
  }
  await expect(
    applyBillingRiskEvent({ ...event, livemode: true }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    (
      await withTenant(t.businessId, t.owner.actor, (tx) =>
        tx.select().from(shopSubscription),
      )
    )[0].status,
  ).toBe("none");
});

it("keeps production read-only while subscription billing configuration is missing", () => {
  process.env.APP_ENV = "production";
  const access = billingAccess(null, new Date(), false);
  expect(access.kind).toBe("unavailable");
  expect(canMakeChanges(access)).toBe(false);
});
