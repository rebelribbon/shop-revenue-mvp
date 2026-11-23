import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { summarizeSubscriptionPricing } from "@/lib/subscription-pricing";

const now = new Date("2026-11-23T12:00:00Z");
const coupon = {
  id: "coupon_lifetime",
  percent_off: 100,
  duration: "forever",
  valid: false,
  max_redemptions: 1,
  times_redeemed: 1,
  redeem_by: 1,
  applies_to: { products: ["prod_crm"] },
};
const discount = {
  id: "di_applied",
  start: 1,
  end: null,
  source: { type: "coupon", coupon },
};
const item = {
  quantity: 1,
  discounts: [],
  price: {
    product: "prod_crm",
    unit_amount: 4999,
    currency: "usd",
    billing_scheme: "per_unit",
    recurring: {
      interval: "month",
      interval_count: 1,
      usage_type: "licensed",
    },
  },
};
function summarize(overrides: Record<string, unknown> = {}) {
  return summarizeSubscriptionPricing(
    {
      discounts: [],
      items: { data: [item], has_more: false },
      ...overrides,
    } as unknown as Stripe.Subscription,
    now,
  );
}

describe("the actual recurring subscription price", () => {
  it("shows the configured recurring price without a discount", () => {
    expect(summarize()).toEqual({
      baseLabel: "$49.99/month",
      recurringLabel: "$49.99/month",
      discountLabel: null,
      freeForever: false,
    });
  });

  it.each(["trialing", "active"])(
    "keeps an assigned lifetime discount after its redemption limit or redemption deadline (%s)",
    (status) => {
      expect(summarize({ status, discounts: [discount] })).toEqual({
        baseLabel: "$49.99/month",
        recurringLabel: "$0/month",
        discountLabel: "100% off forever",
        freeForever: true,
      });
    },
  );

  it.each(["once", "repeating"])(
    "never describes a %s coupon as free forever",
    (duration) => {
      expect(
        summarize({
          discounts: [
            { ...discount, source: { coupon: { ...coupon, duration } } },
          ],
        }),
      ).toMatchObject({
        recurringLabel: null,
        discountLabel: "Discount applied",
        freeForever: false,
      });
    },
  );

  it("does not promise a lifetime discount for another product or an uncovered additional item", () => {
    const otherItem = {
      ...item,
      price: { ...item.price, product: "prod_other" },
    };
    expect(
      summarize({
        discounts: [discount],
        items: { data: [otherItem], has_more: false },
      }),
    ).toMatchObject({ recurringLabel: null, freeForever: false });
    expect(
      summarize({
        discounts: [discount],
        items: { data: [item, otherItem], has_more: false },
      }),
    ).toMatchObject({ recurringLabel: null, freeForever: false });
  });

  it("does not guess a charge when the applied discount has not been expanded", () => {
    expect(summarize({ discounts: ["di_not_expanded"] })).toMatchObject({
      recurringLabel: null,
      discountLabel: "Discount applied",
      freeForever: false,
    });
    expect(
      summarize({
        discounts: [
          { ...discount, source: { type: "coupon", coupon: "coupon_id" } },
        ],
      }),
    ).toMatchObject({ recurringLabel: null, freeForever: false });
  });

  it("stops applying an expired discount, and never promises a time-limited discount forever", () => {
    expect(summarize({ discounts: [{ ...discount, end: 100 }] })).toMatchObject(
      { recurringLabel: "$49.99/month", freeForever: false },
    );
    expect(
      summarize({
        discounts: [{ ...discount, end: now.getTime() / 1000 + 3600 }],
      }),
    ).toMatchObject({ recurringLabel: null, freeForever: false });
  });

  it("recognizes a fully covered item discount but never guesses usage-based charges", () => {
    expect(
      summarize({
        items: { data: [{ ...item, discounts: [discount] }], has_more: false },
      }),
    ).toMatchObject({ recurringLabel: "$0/month", freeForever: true });
    expect(
      summarize({
        discounts: [discount],
        items: {
          data: [
            {
              ...item,
              price: {
                ...item.price,
                recurring: { ...item.price.recurring, usage_type: "metered" },
              },
            },
          ],
          has_more: false,
        },
      }),
    ).toMatchObject({ recurringLabel: null, freeForever: false });
  });
});
