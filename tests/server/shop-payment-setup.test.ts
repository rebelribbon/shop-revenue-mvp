import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { shopPaymentSetup } from "@/lib/shop-payment-setup";

beforeEach(() => {
  vi.stubEnv("APP_ENV", "production");
  vi.stubEnv("STRIPE_SECRET_KEY", "configured-server-credential");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "configured-webhook-credential");
  vi.stubEnv("PAYMENTS_BASE_URL", "https://payments.example.test");
  vi.stubEnv("STRIPE_CONNECT_CLIENT_ID", "");
});
afterEach(() => vi.unstubAllEnvs());

it("keeps new connections unavailable until the platform has a Connect client ID", () => {
  expect(shopPaymentSetup(null)).toMatchObject({
    connected: false,
    active: false,
    available: false,
    platformPending: true,
  });
  vi.stubEnv("STRIPE_CONNECT_CLIENT_ID", "ca_validClientIdentifier");
  const state = shopPaymentSetup(null);
  expect(state.available).toBe(true);
  expect(JSON.stringify(state)).not.toContain("credential");
  expect(JSON.stringify(state)).not.toContain("ca_validClientIdentifier");
});

it("requires complete runtime configuration and the correct live environment", () => {
  const account = {
    accountId: "acct_existing",
    cardPaymentsStatus: "active",
    livemode: true,
  };
  expect(shopPaymentSetup(account)).toMatchObject({
    connected: true,
    active: true,
    available: true,
  });
  expect(shopPaymentSetup({ ...account, livemode: false })).toMatchObject({
    active: false,
    available: false,
  });
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
  expect(shopPaymentSetup(account).available).toBe(false);
});

it("keeps disconnected accounts inactive and preserves support read-only state", () => {
  const state = shopPaymentSetup(
    {
      accountId: "acct_old",
      cardPaymentsStatus: "disconnected",
      livemode: true,
    },
    true,
  );
  expect(state).toMatchObject({
    connected: false,
    active: false,
    available: false,
    readOnly: true,
  });
});
