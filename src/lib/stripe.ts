import Stripe from "stripe";
import { AppError } from "./errors";
export function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key)
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      "Online payments are not configured yet.",
    );
  if (!(stripeLivemode() ? /^(rk|sk)_live_/ : /^(rk|sk)_test_/).test(key))
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      "A sandbox API key is required in this environment.",
    );
  return new Stripe(key, { maxNetworkRetries: 2, timeout: 20000 });
}
export const stripeLivemode = () => process.env.APP_ENV === "production";
export function paymentBaseUrl() {
  const value = process.env.PAYMENTS_BASE_URL || process.env.APP_BASE_URL;
  if (!value)
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      "Payment return address is not configured.",
    );
  const u = new URL(value);
  if (
    u.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(u.hostname)
  )
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      "A secure payment return address is required.",
    );
  return u.origin;
}

export function safeStripeError(error: unknown) {
  return error instanceof Stripe.errors.StripeError
    ? new AppError(
        "PROVIDER_UNAVAILABLE",
        "Stripe could not complete this request. Refresh payment status before retrying.",
      )
    : error;
}
