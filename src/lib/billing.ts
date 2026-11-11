// Shop Revenue's own monthly subscription: pure access rules, no I/O.
export const TRIAL_DAYS = 14;
export const MONTHLY_PRICE_CENTS = 4999;
export const GRACE_DAYS = 7;
const DAY_MS = 86400000;

export type SubscriptionStatus =
  | "none"
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

// full: everything works. grace: works, but the card failed and the shop is
// counting down. setup: no subscription yet. locked: view and export only.
export type BillingAccess =
  | { kind: "off" }
  | { kind: "unavailable" }
  | { kind: "comped" }
  | { kind: "full"; trialEndsAt: Date | null; cancelAt: Date | null }
  | { kind: "grace"; lockAt: Date }
  | { kind: "setup" }
  | { kind: "locked"; reason: "payment_failed" | "canceled" };

export function billingEnabled(env = process.env) {
  return Boolean(
    env.STRIPE_SECRET_KEY &&
    env.STRIPE_BILLING_WEBHOOK_SECRET &&
    (env.STRIPE_SUBSCRIPTION_PRICE_ID ||
      env.STRIPE_SUBSCRIPTION_LOOKUP_KEY === "shop_revenue_monthly") &&
    (env.PAYMENTS_BASE_URL || env.APP_BASE_URL),
  );
}

export function billingAccess(
  row: {
    status: string;
    comped: boolean;
    pastDueSince: Date | null;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
  } | null,
  now: Date,
  enabled = billingEnabled(),
): BillingAccess {
  if (!enabled)
    return {
      kind: process.env.APP_ENV === "production" ? "unavailable" : "off",
    };
  if (row?.comped) return { kind: "comped" };
  switch (row?.status ?? "none") {
    case "trialing":
    case "active":
      return {
        kind: "full",
        trialEndsAt: row!.status === "trialing" ? row!.trialEndsAt : null,
        cancelAt: row!.cancelAtPeriodEnd ? row!.currentPeriodEnd : null,
      };
    case "past_due": {
      const since = row!.pastDueSince ?? now;
      const lockAt = new Date(since.getTime() + GRACE_DAYS * DAY_MS);
      return now < lockAt
        ? { kind: "grace", lockAt }
        : { kind: "locked", reason: "payment_failed" };
    }
    case "unpaid":
      return { kind: "locked", reason: "payment_failed" };
    case "canceled":
    case "paused":
    case "incomplete_expired":
      return { kind: "locked", reason: "canceled" };
    default:
      return { kind: "setup" };
  }
}

export const canMakeChanges = (a: BillingAccess) =>
  a.kind === "off" ||
  a.kind === "comped" ||
  a.kind === "full" ||
  a.kind === "grace";

export const daysUntil = (d: Date, now: Date) =>
  Math.max(0, Math.ceil((d.getTime() - now.getTime()) / DAY_MS));

export const publicSignupEnabled = () =>
  process.env.PUBLIC_SIGNUP_ENABLED === "true";
