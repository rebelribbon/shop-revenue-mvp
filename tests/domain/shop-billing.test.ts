import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { auditEvent, shopSubscription } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  applySubscriptionEvent,
  assertCanMakeChanges,
  getShopSubscription,
  setShopComped,
  syncSubscription,
} from "@/domain/billing";
import { withPaymentTenant } from "@/domain/payments";
import { billingAccess, canMakeChanges } from "@/lib/billing";
import { createInternalUser, meta, seedTenant } from "../helpers/fixtures";

const KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_SUBSCRIPTION_PRICE_ID",
  "PAYMENTS_BASE_URL",
] as const;
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  process.env.STRIPE_SECRET_KEY = "sk_test_synthetic";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_synthetic";
  process.env.STRIPE_SUBSCRIPTION_PRICE_ID = "price_synthetic";
  process.env.PAYMENTS_BASE_URL = "https://payments.example.test";
});
afterEach(() => {
  for (const k of KEYS)
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

const DAY = 86400000;
const row = (over: Partial<Parameters<typeof billingAccess>[0] & object>) => ({
  status: "none",
  comped: false,
  pastDueSince: null,
  trialEndsAt: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  ...over,
});

describe("billing access rules", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  it("is off when billing is not configured", () => {
    expect(billingAccess(null, now, false).kind).toBe("off");
  });
  it("requires a trial before changes, then allows trialing and active", () => {
    expect(billingAccess(null, now, true).kind).toBe("setup");
    expect(billingAccess(row({ status: "incomplete" }), now, true).kind).toBe(
      "setup",
    );
    expect(billingAccess(row({ status: "trialing" }), now, true).kind).toBe(
      "full",
    );
    expect(billingAccess(row({ status: "active" }), now, true).kind).toBe(
      "full",
    );
  });
  it("gives 7 days of grace after a failed payment, then read-only", () => {
    const day6 = billingAccess(
      row({
        status: "past_due",
        pastDueSince: new Date(now.getTime() - 6 * DAY),
      }),
      now,
      true,
    );
    expect(day6.kind).toBe("grace");
    expect(canMakeChanges(day6)).toBe(true);
    const day7 = billingAccess(
      row({
        status: "past_due",
        pastDueSince: new Date(now.getTime() - 7 * DAY),
      }),
      now,
      true,
    );
    expect(day7).toEqual({ kind: "locked", reason: "payment_failed" });
    expect(canMakeChanges(day7)).toBe(false);
  });
  it("locks canceled and unpaid shops, but never comped ones", () => {
    expect(billingAccess(row({ status: "canceled" }), now, true)).toEqual({
      kind: "locked",
      reason: "canceled",
    });
    expect(billingAccess(row({ status: "unpaid" }), now, true).kind).toBe(
      "locked",
    );
    expect(
      billingAccess(row({ status: "canceled", comped: true }), now, true).kind,
    ).toBe("comped");
  });
});

const fakeSub = (
  id: string,
  customer: string,
  businessId: string,
  over: Partial<Stripe.Subscription> = {},
) =>
  ({
    id,
    customer,
    status: "trialing",
    trial_start: 1793500000,
    trial_end: 1794709600,
    cancel_at_period_end: false,
    cancel_at: null,
    metadata: { business_id: businessId },
    items: { data: [{ current_period_end: 1794709600 }] },
    ...over,
  }) as unknown as Stripe.Subscription;

async function shopWithCustomer(label: string) {
  const t = await seedTenant(label, { withStaff: true });
  const customer = `cus_${label.replace(/\W/g, "")}${Date.now()}`;
  await withTenant(t.businessId, t.owner.actor, async (tx) => {
    await tx
      .insert(shopSubscription)
      .values({ businessId: tx.businessId, createdByUserId: tx.actor.id });
    await tx
      .update(shopSubscription)
      .set({ stripeCustomerId: customer })
      .where(eq(shopSubscription.businessId, tx.businessId));
  });
  return { t, customer };
}

describe("subscription records", () => {
  it("blocks changes until the trial starts, then allows them", async () => {
    const { t, customer } = await shopWithCustomer("Billing gate");
    await expect(
      withTenant(t.businessId, t.owner.actor, (tx) => assertCanMakeChanges(tx)),
    ).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    expect(
      await syncSubscription(
        t.businessId,
        fakeSub("sub_gate", customer, t.businessId),
        meta(),
      ),
    ).toBe(true);
    await withTenant(t.businessId, t.staff!.actor, (tx) =>
      assertCanMakeChanges(tx),
    );
    const r = await withTenant(t.businessId, t.owner.actor, (tx) =>
      getShopSubscription(tx),
    );
    expect(r).toMatchObject({
      status: "trialing",
      stripeSubscriptionId: "sub_gate",
      trialEndsAt: new Date(1794709600 * 1000),
      currentPeriodEnd: new Date(1794709600 * 1000),
    });
    expect(r!.trialUsedAt).not.toBeNull();
  });

  it("only the payment processor can record status; owners and staff cannot", async () => {
    const { t } = await shopWithCustomer("Billing guard");
    await expect(
      withTenant(t.businessId, t.owner.actor, (tx) =>
        tx
          .update(shopSubscription)
          .set({ status: "active" })
          .where(eq(shopSubscription.businessId, tx.businessId)),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(t.businessId, t.owner.actor, (tx) =>
        tx
          .update(shopSubscription)
          .set({ comped: true })
          .where(eq(shopSubscription.businessId, tx.businessId)),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(t.businessId, t.owner.actor, (tx) =>
        tx
          .update(shopSubscription)
          .set({ stripeCustomerId: "cus_swapped" })
          .where(eq(shopSubscription.businessId, tx.businessId)),
      ),
    ).rejects.toThrow();
    const other = await seedTenant("Billing staff", { withStaff: true });
    await expect(
      withTenant(other.businessId, other.staff!.actor, (tx) =>
        tx.insert(shopSubscription).values({ businessId: tx.businessId }),
      ),
    ).rejects.toThrow();
    await expect(
      withPaymentTenant(t.businessId, (tx) =>
        tx
          .update(shopSubscription)
          .set({ comped: true })
          .where(eq(shopSubscription.businessId, tx.businessId)),
      ),
    ).rejects.toThrow();
  });

  it("gives 7 days to fix a failed card and ignores a replaced subscription's late events", async () => {
    const { t, customer } = await shopWithCustomer("Billing grace");
    await syncSubscription(
      t.businessId,
      fakeSub("sub_new", customer, t.businessId, { status: "past_due" }),
      meta(),
    );
    const owner = (fn: Parameters<typeof withTenant>[2]) =>
      withTenant(t.businessId, t.owner.actor, fn);
    const r = (await owner((tx) => getShopSubscription(tx))) as Awaited<
      ReturnType<typeof getShopSubscription>
    >;
    expect(r!.pastDueSince).not.toBeNull();
    await owner((tx) => assertCanMakeChanges(tx));
    expect(
      await syncSubscription(
        t.businessId,
        fakeSub("sub_old", customer, t.businessId, { status: "canceled" }),
        meta(),
      ),
    ).toBe(false);
    // A different Stripe customer can never update this shop.
    expect(
      await syncSubscription(
        t.businessId,
        fakeSub("sub_x", "cus_someone_else", t.businessId, {
          status: "active",
        }),
        meta(),
      ),
    ).toBe(false);
    await syncSubscription(
      t.businessId,
      fakeSub("sub_new", customer, t.businessId, { status: "canceled" }),
      meta(),
    );
    await expect(owner((tx) => assertCanMakeChanges(tx))).rejects.toMatchObject(
      { code: "NOT_ELIGIBLE" },
    );
    const changes = await withTenant(t.businessId, t.owner.actor, (tx) =>
      tx
        .select()
        .from(auditEvent)
        .where(eq(auditEvent.action, "billing.status_changed")),
    );
    expect(changes.length).toBeGreaterThanOrEqual(2);
  });

  it("internal staff can give a shop free access, which unlocks it", async () => {
    const { t } = await shopWithCustomer("Billing comp");
    const admin = await createInternalUser("admin");
    await setShopComped({ internalUserId: admin.id }, meta(), {
      businessId: t.businessId,
      comped: true,
      reason: "TEST pilot shop",
    });
    await withTenant(t.businessId, t.owner.actor, (tx) =>
      assertCanMakeChanges(tx),
    );
    await setShopComped({ internalUserId: admin.id }, meta(), {
      businessId: t.businessId,
      comped: false,
      reason: "",
    });
    await expect(
      withTenant(t.businessId, t.owner.actor, (tx) => assertCanMakeChanges(tx)),
    ).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
  });

  it("leaves billing off, and every shop unlocked, until a price is configured", async () => {
    delete process.env.STRIPE_SUBSCRIPTION_PRICE_ID;
    const t = await seedTenant("Billing off");
    await withTenant(t.businessId, t.owner.actor, (tx) =>
      assertCanMakeChanges(tx),
    );
  });

  it("ignores Connect events and unrelated event types without calling Stripe", async () => {
    expect(
      await applySubscriptionEvent({
        id: "evt_connect",
        type: "customer.subscription.updated",
        account: "acct_123",
        livemode: false,
        data: { object: { id: "sub_1" } },
      } as unknown as Stripe.Event),
    ).toBe(false);
    expect(
      await applySubscriptionEvent({
        id: "evt_other",
        type: "charge.succeeded",
        livemode: false,
        data: { object: { id: "ch_1" } },
      } as unknown as Stripe.Event),
    ).toBe(false);
  });
});
