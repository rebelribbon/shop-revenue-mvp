import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { stripeConnection, stripeOAuthAttempt } from "@/db/schema";
import { withTenant, type Actor } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import { stripeClient, stripeLivemode } from "@/lib/stripe";
import {
  stripeConnectAuthorizationUrl,
  STRIPE_CONNECT_TTL_SECONDS,
} from "@/lib/stripe-connect";
import { hashToken, isWellFormedToken, newToken } from "@/lib/tokens";
import { assertOwner } from "./membership";
import { getStripeConnection, prepareStripeConnection } from "./payments";
import { audit, type RequestMeta } from "./records";

type Shop = { businessId: string; actor: Actor };
const expired = () =>
  new AppError(
    "VALIDATION",
    "That Stripe connection request expired or was already used. Start again.",
  );

export async function beginStripeConnection(shop: Shop, meta: RequestMeta) {
  const nonce = newToken();
  const url = stripeConnectAuthorizationUrl(nonce.token);
  await withTenant(shop.businessId, shop.actor, async (tx) => {
    await assertOwner(tx);
    const prepared = await prepareStripeConnection(tx);
    const [connection] = await tx
      .select()
      .from(stripeConnection)
      .where(eq(stripeConnection.id, prepared.id))
      .for("update");
    if (!connection) throw expired();
    if (connection.livemode !== stripeLivemode())
      throw new AppError(
        "CONFLICT",
        "Stripe account is in the wrong payment environment.",
      );
    if (
      connection.accountId &&
      connection.cardPaymentsStatus !== "disconnected"
    )
      throw new AppError(
        "CONFLICT",
        "This shop is already connected to Stripe.",
      );
    await tx
      .delete(stripeOAuthAttempt)
      .where(
        and(
          eq(stripeOAuthAttempt.businessId, shop.businessId),
          eq(stripeOAuthAttempt.ownerId, shop.actor.id!),
          lt(stripeOAuthAttempt.expiresAt, sql`now()-interval '1 day'`),
        ),
      );
    await tx
      .update(stripeOAuthAttempt)
      .set({ consumedAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(stripeOAuthAttempt.businessId, shop.businessId),
          eq(stripeOAuthAttempt.ownerId, shop.actor.id!),
          isNull(stripeOAuthAttempt.consumedAt),
        ),
      );
    const [attempt] = await tx
      .insert(stripeOAuthAttempt)
      .values({
        businessId: shop.businessId,
        ownerId: shop.actor.id!,
        createdByUserId: shop.actor.id,
        stateHash: nonce.hash,
        livemode: stripeLivemode(),
        expiresAt: new Date(Date.now() + STRIPE_CONNECT_TTL_SECONDS * 1000),
      })
      .returning({ id: stripeOAuthAttempt.id });
    await audit(tx, meta, {
      action: "stripe.connection_started",
      targetType: "stripe_oauth_attempt",
      targetId: attempt.id,
      after: { method: "oauth", livemode: stripeLivemode() },
    });
  });
  return { url, state: nonce.token };
}

// Consume in its own committed transaction BEFORE exchanging the code. Stripe's
// token endpoint is not idempotent: retrying a code can revoke the connection.
export async function consumeStripeConnection(shop: Shop, state: string) {
  if (!isWellFormedToken(state)) throw expired();
  return withTenant(shop.businessId, shop.actor, async (tx) => {
    await assertOwner(tx);
    const [attempt] = await tx
      .update(stripeOAuthAttempt)
      .set({
        consumedAt: sql`clock_timestamp()`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(stripeOAuthAttempt.businessId, shop.businessId),
          eq(stripeOAuthAttempt.ownerId, shop.actor.id!),
          eq(stripeOAuthAttempt.stateHash, hashToken(state)),
          eq(stripeOAuthAttempt.livemode, stripeLivemode()),
          isNull(stripeOAuthAttempt.consumedAt),
          gt(stripeOAuthAttempt.expiresAt, sql`now()`),
        ),
      )
      .returning({ id: stripeOAuthAttempt.id });
    if (!attempt) throw expired();
    return attempt;
  });
}

export async function finishStripeConnection(
  shop: Shop,
  meta: RequestMeta,
  state: string,
  code: string | null,
) {
  if (code !== null && (code.length > 512 || !/^ac_[A-Za-z0-9_-]+$/.test(code)))
    throw new AppError(
      "VALIDATION",
      "Stripe did not return a valid connection code. Start again.",
    );
  const attempt = await consumeStripeConnection(shop, state);
  if (code === null) {
    await withTenant(shop.businessId, shop.actor, (tx) =>
      audit(tx, meta, {
        action: "stripe.connection_canceled",
        targetType: "stripe_oauth_attempt",
        targetId: attempt.id,
      }),
    );
    return { canceled: true as const };
  }
  const stripe = stripeClient();
  const authorization = await stripe.oauth.token(
    { grant_type: "authorization_code", code },
    { maxNetworkRetries: 0 },
  );
  const accountId = authorization.stripe_user_id;
  if (
    authorization.livemode !== stripeLivemode() ||
    authorization.scope !== "read_write" ||
    authorization.token_type !== "bearer" ||
    !accountId ||
    !/^acct_[A-Za-z0-9]+$/.test(accountId)
  )
    throw new AppError(
      "FORBIDDEN",
      "Stripe did not grant the required shop connection.",
    );
  // OAuth-authenticated accounts require the Accounts v1 API. We keep only the
  // trusted account identifier; returned access/refresh tokens are discarded.
  const account = await stripe.accounts.retrieve(accountId);
  if (account.id !== accountId || account.type !== "standard")
    throw new AppError(
      "FORBIDDEN",
      "Choose a Stripe account with its own Stripe Dashboard.",
    );
  const status =
    account.charges_enabled && account.capabilities?.card_payments === "active"
      ? "active"
      : "inactive";
  return withTenant(shop.businessId, shop.actor, async (tx) => {
    await assertOwner(tx);
    const [connection] = await tx
      .select()
      .from(stripeConnection)
      .where(eq(stripeConnection.businessId, shop.businessId))
      .for("update");
    if (!connection || connection.livemode !== stripeLivemode())
      throw expired();
    if (connection.accountId && connection.accountId !== accountId)
      throw new AppError(
        "CONFLICT",
        "This shop is already linked to a different Stripe account. Contact support.",
      );
    await tx
      .update(stripeConnection)
      .set({
        accountId,
        connectionMethod: "oauth",
        cardPaymentsStatus: status,
        updatedAt: new Date(),
      })
      .where(eq(stripeConnection.id, connection.id));
    await audit(tx, meta, {
      action: "stripe.account_connected",
      targetType: "stripe_connection",
      targetId: connection.id,
      after: { accountId, method: "oauth", cardPaymentsStatus: status },
    });
    return { canceled: false as const, active: status === "active" };
  });
}

export async function currentStripeConnection(shop: Shop) {
  return withTenant(shop.businessId, shop.actor, (tx) =>
    getStripeConnection(tx),
  );
}
