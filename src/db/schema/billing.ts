import { boolean, text, timestamp, unique } from "drizzle-orm/pg-core";
import { app, tenantColumns } from "./common";

// The shop's own Shop Revenue subscription. Stripe is the source of truth; this
// row is synced from it (migration 0026 guards who may write which columns).
export const shopSubscription = app.table(
  "shop_subscription",
  {
    ...tenantColumns(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    status: text("status").notNull().default("none"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    pastDueSince: timestamp("past_due_since", { withTimezone: true }),
    trialUsedAt: timestamp("trial_used_at", { withTimezone: true }),
    livemode: boolean("livemode").notNull().default(false),
    comped: boolean("comped").notNull().default(false),
    compedReason: text("comped_reason"),
  },
  (t) => [
    unique().on(t.businessId),
    unique().on(t.stripeCustomerId),
    unique().on(t.stripeSubscriptionId),
  ],
);
