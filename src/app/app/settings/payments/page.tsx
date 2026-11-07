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
        Accept customer invoice payments into your shop’s Stripe account. Stripe
        handles checkout, card details, payouts, and account verification.
      </p>
      <section className="card">
        {notice && <p role="status">{notice}</p>}
        <h2>
          {c?.cardPaymentsStatus === "active"
            ? "Online payments enabled"
            : c?.cardPaymentsStatus === "disconnected"
              ? "Reconnect your shop"
              : c?.accountId
                ? "Finish Stripe setup"
                : "Connect your shop"}
        </h2>
        {c && (
          <p>{c.livemode ? "Live payments" : "Sandbox · test payments only"}</p>
        )}
        <p>
          Your shop pays Stripe’s processing fees directly. Shop Revenue adds no
          transaction fee.
        </p>
        {needsConnection && (
          <p>
            Sign in to Stripe and choose your shop’s account. Stripe will ask
            you to authorize the connection. If you’re new to Stripe, you can
            create an account there.
          </p>
        )}
        {!configured || (needsConnection && !signInReady) ? (
          <p>
            Stripe connection setup is awaiting activation. You can still record
            cash, check, and card payments taken outside this app.
          </p>
        ) : (
          s.actor.type !== "support" && (
            <>
              <StripeButton
                kind="connect"
                label={
                  needsConnection
                    ? "Connect with Stripe"
                    : c?.connectionMethod === "oauth"
                      ? "Open Stripe"
                      : "Finish / update Stripe setup"
                }
              />
              {c?.accountId &&
                c.cardPaymentsStatus !== "disconnected" &&
                process.env.STRIPE_PUBLISHABLE_KEY && (
                  <StripeNotifications
                    publishableKey={process.env.STRIPE_PUBLISHABLE_KEY}
                  />
                )}
              {c?.accountId && <StripeButton kind="reconcile" />}
            </>
          )
        )}
        {c?.accountId && (
          <p>
            <a
              href={`https://dashboard.stripe.com/${c.accountId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Stripe Dashboard for payouts, disputes, and account
              requirements
            </a>
          </p>
        )}
      </section>
      <p>
        <Link href="/app/invoices">Back to invoices</Link>
      </p>
    </HydratedMain>
  );
}
