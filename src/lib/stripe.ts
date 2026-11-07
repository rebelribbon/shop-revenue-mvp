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
  if (!(error instanceof Stripe.errors.StripeError)) return error;
  return new AppError(
    "PROVIDER_UNAVAILABLE",
    error.code === "account_create_activation_required"
      ? "Shop Revenue’s Stripe connection is awaiting activation. Please contact support."
      : "Stripe could not complete this request. Check payment status before starting a new request.",
    { stripeDiagnostic: pickStripeDiagnostic(error) },
  );
}

// Provider messages and bodies can contain personal data, codes or credentials.
// Logs receive only fixed categories and Stripe's opaque request identifier.
const diagnosticCodes = new Set([
  "account_create_activation_required",
  "api_key_expired",
  "authentication_required",
  "capability_not_active",
  "invalid_client",
  "invalid_grant",
  "invalid_scope",
  "resource_missing",
  "parameter_missing",
  "permission_denied",
  "rate_limit",
  "insufficient_permissions",
  "invalid_request_error",
]);
function pickStripeDiagnostic(value: unknown) {
  const e =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    stripeCode:
      typeof e.code === "string" && diagnosticCodes.has(e.code)
        ? e.code
        : "other",
    stripeStatus:
      typeof e.statusCode === "number" &&
      Number.isInteger(e.statusCode) &&
      e.statusCode >= 400 &&
      e.statusCode <= 599
        ? e.statusCode
        : null,
    stripeRequestId:
      typeof e.requestId === "string" &&
      /^req_[A-Za-z0-9]{8,80}$/.test(e.requestId)
        ? e.requestId
        : null,
  };
}
export function stripeErrorDiagnostic(error: AppError) {
  const value = error.details?.stripeDiagnostic;
  if (!value || typeof value !== "object") return null;
  const stored = value as Record<string, unknown>;
  return pickStripeDiagnostic({
    code: stored.stripeCode,
    statusCode: stored.stripeStatus,
    requestId: stored.stripeRequestId,
  });
}
