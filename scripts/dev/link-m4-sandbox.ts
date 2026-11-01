// Explicit, sandbox-only fixture setup. Never runs in the web application.
import { and, eq, sql } from "drizzle-orm";
import { business, stripeConnection } from "../../src/db/schema";
import { closePools, withTenant } from "../../src/db/tenant";
import { audit } from "../../src/domain/records";
import { stripeClient } from "../../src/lib/stripe";

const businessId = "01a1759e-9ea6-799a-b204-ce4be65f85fb";
const accountId = "acct_1UVJtq2fKiM8lfFO";
const previewRef = "gcclcuvdrqqllolxqhok";

async function main() {
  if (
    process.env.M4_SANDBOX_SETUP !== "true" ||
    process.env.APP_ENV === "production" ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !== `https://${previewRef}.supabase.co`
  )
    throw new Error("Sandbox fixture setup is not enabled for this preview");
  const connection = new URL(process.env.DATABASE_URL_WORKER ?? "");
  if (connection.username !== `worker_user.${previewRef}`)
    throw new Error("Refusing an unexpected database role or project");
  const account = await stripeClient().v2.core.accounts.retrieve(accountId, {
    include: ["configuration.merchant"],
  });
  if (account.livemode || account.dashboard !== "full")
    throw new Error("Expected the existing full-Dashboard sandbox merchant");
  const status =
    account.configuration?.merchant?.capabilities?.card_payments?.status;
  if (!status) throw new Error("Stripe did not return a card-payment status");

  const result = await withTenant(
    businessId,
    { type: "system", id: null },
    async (tx) => {
      // Serialize fixture retries without allowing an account reassignment.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${businessId}, 0))`,
      );
      const [shop] = await tx
        .select()
        .from(business)
        .where(eq(business.id, businessId));
      if (shop?.legalName !== "Preview Shop LLC" || shop.status !== "active")
        throw new Error("The expected preview shop was not found");
      const [prior] = await tx
        .select()
        .from(stripeConnection)
        .where(eq(stripeConnection.businessId, businessId));
      if (prior?.accountId && prior.accountId !== accountId)
        throw new Error("Refusing to replace another connected account");
      if (!prior) {
        const [row] = await tx
          .insert(stripeConnection)
          .values({
            businessId,
            accountId,
            livemode: false,
            cardPaymentsStatus: status,
          })
          .returning();
        await audit(
          tx,
          { requestId: "m4-sandbox-owner-onboarding-20261028" },
          {
            action: "stripe.sandbox_fixture_connected",
            targetType: "stripe_connection",
            targetId: row.id,
            after: { accountId, livemode: false },
          },
        );
      } else {
        if (prior.livemode) throw new Error("Refusing a live-mode connection");
        await tx
          .update(stripeConnection)
          .set({ accountId, cardPaymentsStatus: status, updatedAt: new Date() })
          .where(
            and(
              eq(stripeConnection.businessId, businessId),
              eq(stripeConnection.id, prior.id),
            ),
          );
        if (!prior.accountId)
          await audit(
            tx,
            { requestId: "m4-sandbox-owner-onboarding-20261028" },
            {
              action: "stripe.sandbox_fixture_connected",
              targetType: "stripe_connection",
              targetId: prior.id,
              after: { accountId, livemode: false },
            },
          );
      }
      return { connected: true, cardPaymentsStatus: status, livemode: false };
    },
    { role: "worker" },
  );
  console.log(JSON.stringify(result));
}

try {
  await main();
} catch (error) {
  // No raw provider/database errors: they may contain secrets or query data.
  console.error(
    JSON.stringify({
      event: "m4.sandbox_setup_failed",
      errorType: error instanceof Error ? error.name : "unknown",
    }),
  );
  process.exitCode = 1;
} finally {
  await closePools();
}
