import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withTenant } from "@/db/tenant";
import { getBusinessProfile } from "@/domain/business-profile";
import { getShopSubscription } from "@/domain/billing";
import { updateBusinessProfileAction } from "@/server/actions/business";
import { createCustomerAction } from "@/server/actions/customers";
import { seedTenant, type SeededTenant } from "../helpers/fixtures";

const request = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/server/auth/session", () => ({
  getSessionState: request.session,
}));
vi.mock("@/server/auth/assurance", () => ({
  assertSessionAssurance: async () => {},
}));
vi.mock("@/server/request", () => ({
  getRequestMeta: async () => ({ requestId: randomUUID(), ip: null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function signIn(t: SeededTenant, asStaff = false) {
  const member = asStaff ? t.staff! : t.owner;
  request.session.mockResolvedValue({
    kind: "shop",
    session: {
      businessId: t.businessId,
      actor: member.actor,
      userId: member.userId,
      role: asStaff ? "staff" : "owner",
      supportSession: null,
    },
  });
}

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_synthetic");
  vi.stubEnv("STRIPE_BILLING_WEBHOOK_SECRET", "whsec_synthetic");
  vi.stubEnv("STRIPE_SUBSCRIPTION_PRICE_ID", "price_synthetic");
  vi.stubEnv("PAYMENTS_BASE_URL", "https://payments.example.test");
});
afterEach(() => vi.unstubAllEnvs());

it("persists an owner's business setup before a trial while customer creation stays gated", async () => {
  const t = await seedTenant("Before trial");
  signIn(t);
  const input = {
    clientRequestId: randomUUID(),
    legalName: "Setup Shop LLC",
    dba: "Setup Shop",
    phone: "(210) 555-0100",
    addressLine1: "123 Service Road",
    city: "Cibolo",
    region: "TX",
    postalCode: "78108",
    timezone: "America/Chicago",
    taxPercent: 8.25,
    taxConfirmed: "on",
    laborSellRate: 125,
    laborCostRate: 35,
  };
  expect(await updateBusinessProfileAction(input)).toMatchObject({ ok: true });
  expect(
    await withTenant(t.businessId, t.owner.actor, getBusinessProfile),
  ).toMatchObject({
    legalName: input.legalName,
    dba: input.dba,
    phoneE164: "+12105550100",
    city: "Cibolo",
    taxRateBps: 825,
    laborSellRateCents: 12500,
    laborCostRateCents: 3500,
  });
  expect(
    await withTenant(t.businessId, t.owner.actor, getShopSubscription),
  ).toBeNull();
  expect(
    await createCustomerAction({
      clientRequestId: randomUUID(),
      firstName: "Customer",
      lastName: "Before trial",
    }),
  ).toMatchObject({ ok: false, error: { code: "NOT_ELIGIBLE" } });
});

it("retains owner-only access and tax confirmation during unpaid business setup", async () => {
  const t = await seedTenant("Protected setup", { withStaff: true });
  const input = {
    clientRequestId: randomUUID(),
    legalName: "Unauthorized change",
    timezone: "America/Chicago",
    taxPercent: 8.25,
  };
  signIn(t, true);
  expect(await updateBusinessProfileAction(input)).toMatchObject({
    ok: false,
    error: { code: "FORBIDDEN" },
  });
  signIn(t);
  expect(await updateBusinessProfileAction(input)).toMatchObject({
    ok: false,
    error: { code: "VALIDATION", fields: { taxConfirmed: expect.any(String) } },
  });
  expect(
    await withTenant(t.businessId, t.owner.actor, getBusinessProfile),
  ).not.toMatchObject({ legalName: input.legalName });
});
