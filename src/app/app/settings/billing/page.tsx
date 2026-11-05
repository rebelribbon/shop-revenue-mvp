import { HydratedMain } from "@/components/hydrated-main";
import Link from "next/link";
import { BillingButton } from "@/components/billing-button";
import { withTenant } from "@/db/tenant";
import {
  getShopSubscription,
  refreshShopSubscription,
  subscriptionPriceLabel,
} from "@/domain/billing";
import { billingAccess, daysUntil, TRIAL_DAYS } from "@/lib/billing";
import { logger } from "@/lib/logger";
import { requireOwnerView } from "@/server/views/shop";

const fmt = (d: Date) =>
  d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Chicago",
  });

export default async function BillingSettings({
  searchParams,
}: {
  searchParams: Promise<{ started?: string }>;
}) {
  const s = await requireOwnerView("/app/settings/billing");
  if ((await searchParams).started)
    await refreshShopSubscription(s.businessId).catch(() =>
      logger.warn({
        event: "billing.refresh_failed",
        businessId: s.businessId,
      }),
    );
  const { row, access, now } = await withTenant(
    s.businessId,
    s.actor,
    async (tx) => {
      const now = new Date();
      const row = await getShopSubscription(tx);
      return { row, access: billingAccess(row, now), now };
    },
  );
  const price = await subscriptionPriceLabel(
    row?.stripeSubscriptionId ?? undefined,
  );
  const canAct = s.actor.type === "user" && s.role === "owner";
  const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 86400000);
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Billing</h1>
      <p>
        Your Shop Revenue subscription. Stripe keeps your card on file; we never
        see the full number.
      </p>
      <section className="card">
        {access.kind === "unavailable" && (
          <>
            <h2>Billing is temporarily unavailable</h2>
            <p>
              Please contact support to restore billing. You can still view and
              export your records.
            </p>
          </>
        )}
        {access.kind === "off" && (
          <>
            <h2>Billing isn’t turned on yet</h2>
            <p>Everything works. Nothing will be charged.</p>
          </>
        )}
        {access.kind === "comped" && (
          <>
            <h2>Complimentary plan</h2>
            <p>Your shop is not billed. Everything works.</p>
          </>
        )}
        {access.kind === "setup" && (
          <>
            <h2>
              {row?.trialUsedAt
                ? "Restart your subscription"
                : `Start your ${TRIAL_DAYS}-day free trial`}
            </h2>
            {row?.trialUsedAt ? (
              <p>
                {price ? `${price}. ` : ""}Add a card to make changes again.
              </p>
            ) : (
              <p>
                Add a card to start. You won’t be charged until{" "}
                <strong>{fmt(trialEnd)}</strong>
                {price ? `, then ${price}` : ""}. Cancel any time before then
                and you pay nothing.
              </p>
            )}
            {canAct && (
              <BillingButton
                kind="start"
                label={
                  row?.trialUsedAt ? "Restart subscription" : "Start free trial"
                }
              />
            )}
          </>
        )}
        {access.kind === "full" && (
          <>
            <h2>{access.trialEndsAt ? "Free trial" : "Subscription active"}</h2>
            {access.trialEndsAt && (
              <p>
                Your trial ends <strong>{fmt(access.trialEndsAt)}</strong> (
                {daysUntil(access.trialEndsAt, now)} days).{" "}
                {access.cancelAt
                  ? "You canceled, so you won’t be charged."
                  : `Your card will be charged${price ? ` ${price}` : ""} then.`}
              </p>
            )}
            {!access.trialEndsAt && access.cancelAt && (
              <p>
                Canceled. You can keep using Shop Revenue until{" "}
                <strong>{fmt(access.cancelAt)}</strong>.
              </p>
            )}
            {!access.trialEndsAt &&
              !access.cancelAt &&
              row?.currentPeriodEnd && (
                <p>
                  {price ? `${price}. ` : ""}Renews{" "}
                  <strong>{fmt(row.currentPeriodEnd)}</strong>.
                </p>
              )}
            {canAct && (
              <BillingButton
                kind="portal"
                label="Update card, see receipts or cancel"
                primary={false}
              />
            )}
          </>
        )}
        {access.kind === "grace" && (
          <>
            <h2>Your last payment didn’t go through</h2>
            <p>
              Update your card by <strong>{fmt(access.lockAt)}</strong>. After
              that you can still view and export your records, but you can’t
              make changes until billing is fixed.
            </p>
            {canAct && <BillingButton kind="portal" label="Update card" />}
          </>
        )}
        {access.kind === "locked" && (
          <>
            <h2>
              {access.reason === "payment_failed"
                ? "Subscription paused: payment failed"
                : "Subscription ended"}
            </h2>
            <p>
              You can view and export your records. To create jobs, estimates or
              invoices again,{" "}
              {access.reason === "payment_failed"
                ? "update your card."
                : "restart your subscription."}
            </p>
            {canAct && (
              <BillingButton
                kind={access.reason === "payment_failed" ? "portal" : "start"}
                label={
                  access.reason === "payment_failed"
                    ? "Update card"
                    : "Restart subscription"
                }
              />
            )}
          </>
        )}
      </section>
      <p>
        <Link href="/app/settings/export">Export your shop data</Link> ·{" "}
        <Link href="/app/settings">Back to settings</Link>
      </p>
    </HydratedMain>
  );
}
