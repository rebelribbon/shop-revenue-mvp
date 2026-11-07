import Stripe from "stripe";
import { afterEach, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { newToken } from "@/lib/tokens";
import { safeStripeError, stripeErrorDiagnostic } from "@/lib/stripe";
import {
  stripeConnectAuthorizationUrl,
  stripeConnectConfigured,
  stripeConnectCookieName,
  stripeConnectCookieOptions,
  validStripeConnectState,
} from "@/lib/stripe-connect";
afterEach(() => vi.unstubAllEnvs());
it("opens Stripe login with a fixed callback, explicit scope and unpredictable state", () => {
  vi.stubEnv("STRIPE_CONNECT_CLIENT_ID", "ca_testClientIdentifier");
  vi.stubEnv("PAYMENTS_BASE_URL", "https://payments.example.test");
  const nonce = newToken().token;
  const url = new URL(stripeConnectAuthorizationUrl(nonce));
  expect(url.origin).toBe("https://connect.stripe.com");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    response_type: "code",
    client_id: "ca_testClientIdentifier",
    scope: "read_write",
    state: nonce,
    stripe_landing: "login",
    redirect_uri: "https://payments.example.test/stripe/connect/callback",
  });
  expect(validStripeConnectState(nonce, nonce)).toBe(true);
  expect(validStripeConnectState(nonce, newToken().token)).toBe(false);
  expect(validStripeConnectState("bad", "bad")).toBe(false);
});
it("fails closed when Stripe hasn't provided a client ID and uses a secure host-only state cookie in production", () => {
  vi.stubEnv("STRIPE_CONNECT_CLIENT_ID", "");
  vi.stubEnv("APP_ENV", "production");
  expect(stripeConnectConfigured()).toBe(false);
  expect(() => stripeConnectAuthorizationUrl(newToken().token)).toThrow(
    /activation/,
  );
  expect(stripeConnectCookieName()).toMatch(/^__Host-/);
  expect(stripeConnectCookieOptions()).toEqual({
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
});
it("retains only safe provider diagnostics and gives activation failures a useful message", () => {
  const original = new Stripe.errors.StripeInvalidRequestError({
    message: "private-code-and-personal-data",
    code: "account_create_activation_required",
    statusCode: 400,
    requestId: "req_testReference123",
    headers: { authorization: "private-credential" },
  });
  const safe = safeStripeError(original) as AppError;
  expect(safe.message).toContain("awaiting activation");
  expect(stripeErrorDiagnostic(safe)).toEqual({
    stripeCode: "account_create_activation_required",
    stripeStatus: 400,
    stripeRequestId: "req_testReference123",
  });
  expect(JSON.stringify(safe)).not.toContain("private");
  const malicious = new AppError("PROVIDER_UNAVAILABLE", "Untrusted", {
    stripeDiagnostic: {
      stripeCode: "private-code",
      stripeStatus: "private-status",
      stripeRequestId: "private-id",
      body: "private-body",
    },
  });
  expect(stripeErrorDiagnostic(malicious)).toEqual({
    stripeCode: "other",
    stripeStatus: null,
    stripeRequestId: null,
  });
});
