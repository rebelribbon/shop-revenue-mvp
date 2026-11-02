import type Stripe from "stripe";
import { applyStripeEvent } from "./stripe-payments";
import { applySubscriptionEvent, SUBSCRIPTION_EVENTS } from "./billing";

// Connect events (event.account set) are a shop's customer invoice payments;
// platform events are the shop's own Shop Revenue subscription.
export const routeStripeEvent = (event: Stripe.Event) =>
  event.account ? applyStripeEvent(event) : applySubscriptionEvent(event);

export const CONNECT_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "account.updated",
];
export const STRIPE_EVENT_TYPES = [
  ...new Set([...CONNECT_EVENTS, ...SUBSCRIPTION_EVENTS]),
];
