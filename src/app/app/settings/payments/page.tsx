import { HydratedMain } from "@/components/hydrated-main";
import Link from "next/link";
import { StripeNotifications } from "@/components/stripe-notifications";
import { withTenant } from "@/db/tenant";
import { getStripeConnection } from "@/domain/payments";
import { requireOwnerView } from "@/server/views/shop";
import { StripeButton } from "@/components/stripe-controls";
export default async function PaymentsSettings() {
  const s = await requireOwnerView("/app/settings/payments");
  const c = await withTenant(s.businessId, s.actor, (tx) =>
    getStripeConnection(tx),
  );
  const configured = Boolean(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_WEBHOOK_SECRET &&
    process.env.PAYMENTS_BASE_URL,
  );
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Online payments</h1>
      <p>
        Accept customer invoice payments into your shop’s Stripe account. Stripe
        handles checkout, card details, payouts, and account verification.
      </p>
      <section className="card">
        <h2>
          {c?.cardPaymentsStatus === "active"
            ? "Online payments enabled"
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
        {!configured ? (
          <p>
            Online payment setup is being prepared. Manual payment recording
            remains available.
          </p>
        ) : (
          s.actor.type !== "support" && (
            <>
              <StripeButton kind="connect" />
              {c?.accountId && process.env.STRIPE_PUBLISHABLE_KEY && (
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
