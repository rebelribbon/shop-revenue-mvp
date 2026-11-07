import { HydratedMain } from "@/components/hydrated-main";
import Link from "next/link";
import { StripeNotifications } from "@/components/stripe-notifications";
import { withTenant } from "@/db/tenant";
import { getStripeConnection } from "@/domain/payments";
import { requireOwnerView } from "@/server/views/shop";
import { StripeButton } from "@/components/stripe-controls";
import { stripeConnectConfigured } from "@/lib/stripe-connect";
export default async function PaymentsSettings({
  searchParams,
}: {
  searchParams: Promise<{ stripe?: string }>;
}) {
  const s = await requireOwnerView("/app/settings/payments");
  const c = await withTenant(s.businessId, s.actor, (tx) =>
    getStripeConnection(tx),
  );
  const configured = Boolean(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_WEBHOOK_SECRET &&
    process.env.PAYMENTS_BASE_URL,
  );
  const needsConnection =
    !c?.accountId || c.cardPaymentsStatus === "disconnected";
  const signInReady = stripeConnectConfigured();
  const setupAvailable = configured && (!needsConnection || signInReady);
  const platformPending = needsConnection && !signInReady;
  const ownerCanAct = s.actor.type !== "support";
  const notices: Record<string, string> = {
    connected:
      "Your Stripe account is connected. Customers can now pay invoices online.",
    pending:
      "Your Stripe account is connected. Open Stripe to finish its payment requirements.",
    canceled:
      "Stripe connection canceled. You can connect again when you’re ready.",
    expired:
      "That Stripe connection request expired or was already used. Start again.",
    error:
      "Stripe could not finish the connection. Start a new connection request. If it keeps happening, contact support.",
  };
  const outcome = (await searchParams).stripe;
  const knownOutcome = outcome && Object.hasOwn(notices, outcome);
  const confirmedOutcome =
    outcome === "connected"
      ? c?.accountId && c.cardPaymentsStatus === "active"
      : outcome === "pending"
        ? c?.accountId &&
          !["active", "disconnected"].includes(c.cardPaymentsStatus)
        : true;
  const notice = knownOutcome && confirmedOutcome ? notices[outcome] : null;
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Online payments</h1>
      <p>
        Let customers pay invoices by card. Payments go to your shop’s Stripe
        account.
      </p>
      <section className="card">
        {notice && <p role="status">{notice}</p>}
        <h2>
          {c?.cardPaymentsStatus === "active"
            ? "Stripe connected"
            : c?.cardPaymentsStatus === "disconnected"
              ? "Reconnect Stripe"
              : c?.accountId
                ? "Finish Stripe setup"
                : "Connect your Stripe account"}
        </h2>
        {c && !c.livemode && <p>Test mode · no real payments</p>}
        {needsConnection && setupAvailable && (
          <ol>
            <li>
              Select <strong>Connect Stripe</strong> below.
            </li>
            <li>Sign in to Stripe, or create an account for your shop.</li>
            <li>
              Approve the connection. Stripe will guide you through any business
              or bank details it needs.
            </li>
          </ol>
        )}
        {!setupAvailable && (
          <p id="stripe-setup-unavailable" role="status">
            {platformPending
              ? "Shop Revenue is still activating its online payment service. Your shop can connect after that is finished. There is nothing for you to change in your shop’s Stripe settings yet."
              : "Online payment setup is temporarily unavailable. Check setup status to try again."}
          </p>
        )}
        {ownerCanAct && (
          <>
            <StripeButton
              kind="connect"
              disabled={!setupAvailable}
              describedBy={
                !setupAvailable ? "stripe-setup-unavailable" : undefined
              }
              label={
                needsConnection
                  ? "Connect Stripe"
                  : c?.cardPaymentsStatus === "active"
                    ? "Manage Stripe"
                    : "Finish Stripe setup"
              }
            />
            {!setupAvailable && <StripeButton kind="setup-status" />}
            {setupAvailable &&
              c?.accountId &&
              c.cardPaymentsStatus !== "disconnected" &&
              process.env.STRIPE_PUBLISHABLE_KEY && (
                <StripeNotifications
                  publishableKey={process.env.STRIPE_PUBLISHABLE_KEY}
                />
              )}
            {setupAvailable && c?.accountId && (
              <StripeButton kind="reconcile" />
            )}
          </>
        )}
        <p>
          Stripe charges its usual processing fees. Shop Revenue adds no
          transaction fee.
        </p>
        {c?.accountId && (
          <p>
            <a
              href={`https://dashboard.stripe.com/${c.accountId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Stripe Dashboard: payouts and account details
            </a>
          </p>
        )}
      </section>
      <p>
        <Link
          href="/app/settings"
          className={`btn ${ownerCanAct ? "secondary" : "primary"}`}
        >
          Back to settings
        </Link>
      </p>
    </HydratedMain>
  );
}
