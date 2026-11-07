import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditEvent, stripeConnection, stripeOAuthAttempt } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  beginStripeConnection,
  consumeStripeConnection,
  finishStripeConnection,
} from "@/domain/stripe-connect";
import {
  applyStripeEvent,
  refreshShopConnection,
} from "@/domain/stripe-payments";
import { hashToken, newToken } from "@/lib/tokens";
import { meta, seedTenant } from "../helpers/fixtures";

const provider = vi.hoisted(() => ({
  oauth: { token: vi.fn() },
  accounts: { retrieve: vi.fn() },
}));
vi.mock("@/lib/stripe", async (original) => ({
  ...(await original<typeof import("@/lib/stripe")>()),
  stripeClient: () => provider,
}));
type Tenant = Awaited<ReturnType<typeof seedTenant>>;
const shop = (t: Tenant) => ({
  businessId: t.businessId,
  actor: t.owner.actor,
});
const connection = (t: Tenant) =>
  withTenant(
    t.businessId,
    t.owner.actor,
    async (tx) => (await tx.select().from(stripeConnection))[0],
  );
beforeEach(() => {
  vi.resetAllMocks();
  process.env.PAYMENTS_BASE_URL = "https://payments.example.test";
  process.env.STRIPE_CONNECT_CLIENT_ID = "ca_testClientIdentifier";
  provider.oauth.token.mockResolvedValue({
    stripe_user_id: `acct_${randomUUID().replaceAll("-", "")}`,
    livemode: false,
    scope: "read_write",
    token_type: "bearer",
    access_token: "discarded-access",
    refresh_token: "discarded-refresh",
  });
  provider.accounts.retrieve.mockImplementation(async (id: string) => ({
    id,
    type: "standard",
    charges_enabled: true,
    capabilities: { card_payments: "active" },
  }));
});

describe("owner's Stripe account connection", () => {
  it("stores a hashed owner-bound state, binds the trusted account, and never stores OAuth credentials", async () => {
    const t = await seedTenant("OAuth");
    const attempt = await beginStripeConnection(shop(t), meta());
    expect(new URL(attempt.url).searchParams.get("stripe_landing")).toBe(
      "login",
    );
    const [stored] = await withTenant(t.businessId, t.owner.actor, (tx) =>
      tx.select().from(stripeOAuthAttempt),
    );
    expect(stored.stateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.stateHash).not.toBe(attempt.state);
    expect(stored.ownerId).toBe(t.owner.userId);
    expect(
      await finishStripeConnection(
        shop(t),
        meta(),
        attempt.state,
        "ac_test_authorization",
      ),
    ).toEqual({ canceled: false, active: true });
    expect(provider.oauth.token).toHaveBeenCalledWith(
      { grant_type: "authorization_code", code: "ac_test_authorization" },
      { maxNetworkRetries: 0 },
    );
    expect(await connection(t)).toMatchObject({
      connectionMethod: "oauth",
      cardPaymentsStatus: "active",
    });
    const rows = await withTenant(t.businessId, t.owner.actor, (tx) =>
      tx.select().from(auditEvent),
    );
    for (const secret of [
      attempt.state,
      "ac_test_authorization",
      "discarded-access",
      "discarded-refresh",
    ])
      expect(JSON.stringify(rows)).not.toContain(secret);
  });

  it("allows exactly one exchange across simultaneous and repeated callbacks", async () => {
    const t = await seedTenant("OAuth race");
    const { state } = await beginStripeConnection(shop(t), meta());
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        finishStripeConnection(shop(t), meta(), state, "ac_test_race"),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(provider.oauth.token).toHaveBeenCalledTimes(1);
    await expect(
      finishStripeConnection(shop(t), meta(), state, "ac_test_race"),
    ).rejects.toThrow(/expired|already used/);
    expect(provider.oauth.token).toHaveBeenCalledTimes(1);
  });

  it("burns a state before a failed exchange and requires a new authorization", async () => {
    const t = await seedTenant("OAuth uncertainty");
    const { state } = await beginStripeConnection(shop(t), meta());
    provider.oauth.token.mockRejectedValue(new Error("network failure"));
    await expect(
      finishStripeConnection(shop(t), meta(), state, "ac_test_uncertain"),
    ).rejects.toThrow();
    await expect(
      finishStripeConnection(shop(t), meta(), state, "ac_test_uncertain"),
    ).rejects.toThrow(/expired|already used/);
    expect(provider.oauth.token).toHaveBeenCalledTimes(1);
    expect((await connection(t)).accountId).toBeNull();
  });

  it("rejects canceled and superseded attempts without exchanging a code", async () => {
    const t = await seedTenant("OAuth canceled");
    const old = await beginStripeConnection(shop(t), meta());
    const current = await beginStripeConnection(shop(t), meta());
    await expect(consumeStripeConnection(shop(t), old.state)).rejects.toThrow(
      /expired|already used/,
    );
    expect(
      await finishStripeConnection(shop(t), meta(), current.state, null),
    ).toEqual({ canceled: true });
    await expect(
      consumeStripeConnection(shop(t), current.state),
    ).rejects.toThrow();
    expect(provider.oauth.token).not.toHaveBeenCalled();
  });

  it("enforces tenant, owner, expiry and environment binding through real RLS", async () => {
    const a = await seedTenant("OAuth A", { withStaff: true });
    const b = await seedTenant("OAuth B");
    const attempt = await beginStripeConnection(shop(a), meta());
    await expect(
      finishStripeConnection(shop(b), meta(), attempt.state, "ac_cross_shop"),
    ).rejects.toThrow();
    await expect(
      beginStripeConnection(
        { businessId: a.businessId, actor: a.staff!.actor },
        meta(),
      ),
    ).rejects.toThrow(/owner/);
    expect(
      await withTenant(a.businessId, a.staff!.actor, (tx) =>
        tx.select().from(stripeOAuthAttempt),
      ),
    ).toEqual([]);
    await expect(
      withTenant(a.businessId, a.staff!.actor, (tx) =>
        tx.insert(stripeOAuthAttempt).values({
          businessId: a.businessId,
          ownerId: a.staff!.userId,
          stateHash: newToken().hash,
          livemode: false,
          expiresAt: new Date(Date.now() + 600000),
        }),
      ),
    ).rejects.toThrow();
    const expired = newToken(),
      wrongMode = newToken();
    await withTenant(a.businessId, a.owner.actor, (tx) =>
      tx.insert(stripeOAuthAttempt).values([
        {
          businessId: a.businessId,
          ownerId: a.owner.userId,
          stateHash: expired.hash,
          livemode: false,
          createdAt: new Date(Date.now() - 7200000),
          expiresAt: new Date(Date.now() - 3600000),
        },
        {
          businessId: a.businessId,
          ownerId: a.owner.userId,
          stateHash: wrongMode.hash,
          livemode: true,
          expiresAt: new Date(Date.now() + 600000),
        },
      ]),
    );
    for (const state of [expired.token, wrongMode.token, newToken().token])
      await expect(consumeStripeConnection(shop(a), state)).rejects.toThrow(
        /expired|already used/,
      );
    expect(provider.oauth.token).not.toHaveBeenCalled();
    // Failed attacks did not consume the owner's valid request.
    await expect(
      consumeStripeConnection(shop(a), attempt.state),
    ).resolves.toHaveProperty("id");
    await expect(
      withTenant(a.businessId, a.owner.actor, (tx) =>
        tx
          .update(stripeOAuthAttempt)
          .set({ consumedAt: null })
          .where(eq(stripeOAuthAttempt.stateHash, hashToken(attempt.state))),
      ),
    ).rejects.toThrow();
  });

  it.each([
    { livemode: true },
    { scope: "read_only" },
    { stripe_user_id: "wrong" },
    { token_type: "other" },
  ])("rejects an unsuitable trusted token response: %j", async (invalid) => {
    const t = await seedTenant("OAuth invalid grant");
    const { state } = await beginStripeConnection(shop(t), meta());
    const valid = await provider.oauth.token();
    provider.oauth.token.mockResolvedValue({ ...valid, ...invalid });
    provider.oauth.token.mockClear();
    await expect(
      finishStripeConnection(shop(t), meta(), state, "ac_invalid_response"),
    ).rejects.toThrow(/required shop connection/);
    expect(provider.accounts.retrieve).not.toHaveBeenCalled();
    expect((await connection(t)).accountId).toBeNull();
  });

  it("keeps account ownership unique and never changes a shop's bound account", async () => {
    const a = await seedTenant("OAuth account A"),
      b = await seedTenant("OAuth account B");
    const first = await beginStripeConnection(shop(a), meta());
    await finishStripeConnection(shop(a), meta(), first.state, "ac_first");
    const original = (await connection(a)).accountId!;
    const second = await beginStripeConnection(shop(b), meta());
    await expect(
      finishStripeConnection(shop(b), meta(), second.state, "ac_duplicate"),
    ).rejects.toThrow();
    expect((await connection(b)).accountId).toBeNull();
    await withTenant(a.businessId, a.owner.actor, (tx) =>
      tx.update(stripeConnection).set({ cardPaymentsStatus: "disconnected" }),
    );
    const reconnect = await beginStripeConnection(shop(a), meta());
    provider.oauth.token.mockResolvedValue({
      stripe_user_id: "acct_anotherShop",
      livemode: false,
      scope: "read_write",
      token_type: "bearer",
    });
    await expect(
      finishStripeConnection(shop(a), meta(), reconnect.state, "ac_reconnect"),
    ).rejects.toThrow(/different Stripe account/);
    expect((await connection(a)).accountId).toBe(original);
  });

  it("honors a signed deauthorization even while an account refresh is in flight", async () => {
    const t = await seedTenant("OAuth revoked");
    const { state } = await beginStripeConnection(shop(t), meta());
    await finishStripeConnection(shop(t), meta(), state, "ac_connected");
    const c = await connection(t);
    provider.accounts.retrieve.mockImplementationOnce(async (id) => {
      await applyStripeEvent({
        id: `evt_${randomUUID()}`,
        type: "account.application.deauthorized",
        account: id,
        livemode: false,
        data: { object: {} },
      } as Stripe.Event);
      return {
        id,
        type: "standard",
        charges_enabled: true,
        capabilities: { card_payments: "active" },
      };
    });
    await refreshShopConnection(t.businessId);
    expect(await connection(t)).toMatchObject({
      accountId: c.accountId,
      cardPaymentsStatus: "disconnected",
    });
    provider.accounts.retrieve.mockClear();
    await refreshShopConnection(t.businessId);
    expect(provider.accounts.retrieve).not.toHaveBeenCalled();
  });
});
