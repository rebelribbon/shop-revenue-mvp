import type Stripe from "stripe";

export type SubscriptionPricing = {
  baseLabel: string | null;
  recurringLabel: string | null;
  discountLabel: string | null;
  freeForever: boolean;
};

export const unknownSubscriptionPricing: SubscriptionPricing = {
  baseLabel: null,
  recurringLabel: null,
  discountLabel: null,
  freeForever: false,
};

export function recurringPriceLabel(
  amount: number,
  currency: string,
  recurring: { interval: string; interval_count: number },
) {
  const money = (amount / 100).toLocaleString("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: amount % 100 ? 2 : 0,
  });
  const period =
    recurring.interval_count === 1
      ? recurring.interval
      : `${recurring.interval_count} ${recurring.interval}s`;
  return `${money}/${period}`;
}

// A redeemed coupon remains effective after its redemption limit is reached.
// Coupon.valid only describes new redemptions; it must not remove an existing
// customer's lifetime discount. Check scope, duration and the assigned discount.
export function summarizeSubscriptionPricing(
  subscription: Stripe.Subscription,
  now = new Date(),
): SubscriptionPricing {
  const items = subscription.items.data;
  const first = items[0]?.price;
  if (
    !first?.recurring ||
    !items.length ||
    subscription.items.has_more ||
    items.some(
      ({ price, quantity }) =>
        price.unit_amount == null ||
        price.billing_scheme !== "per_unit" ||
        price.currency !== first.currency ||
        price.recurring?.usage_type !== "licensed" ||
        price.recurring.interval !== first.recurring!.interval ||
        price.recurring.interval_count !== first.recurring!.interval_count ||
        quantity == null,
    )
  )
    return { ...unknownSubscriptionPricing };

  const base = items.reduce(
    (sum, item) => sum + item.price.unit_amount! * item.quantity!,
    0,
  );
  const baseLabel = recurringPriceLabel(base, first.currency, first.recurring);
  const active = (discount: string | Stripe.Discount) =>
    typeof discount === "string" ||
    (discount.start <= now.getTime() / 1000 &&
      (!discount.end || discount.end > now.getTime() / 1000));
  const coversForever = (
    discount: string | Stripe.Discount,
    productId: string,
  ) => {
    if (typeof discount === "string" || !active(discount) || discount.end)
      return false;
    const coupon = discount.source?.coupon;
    return (
      coupon != null &&
      typeof coupon !== "string" &&
      coupon.duration === "forever" &&
      coupon.percent_off === 100 &&
      (!coupon.applies_to?.products ||
        coupon.applies_to.products.includes(productId))
    );
  };
  const freeForever =
    base > 0 &&
    items.every((item) => {
      if (item.price.unit_amount === 0 || item.quantity === 0) return true;
      const product = item.price.product;
      const productId = typeof product === "string" ? product : product.id;
      return [...subscription.discounts, ...item.discounts].some((discount) =>
        coversForever(discount, productId),
      );
    });
  const hasDiscount = [
    ...subscription.discounts,
    ...items.flatMap((item) => item.discounts),
  ].some(active);
  return {
    baseLabel,
    recurringLabel: freeForever
      ? recurringPriceLabel(0, first.currency, first.recurring)
      : hasDiscount
        ? null
        : baseLabel,
    discountLabel: freeForever
      ? "100% off forever"
      : hasDiscount
        ? "Discount applied"
        : null,
    freeForever: freeForever && hasDiscount,
  };
}
