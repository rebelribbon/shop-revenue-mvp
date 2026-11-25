"use client";
import Link from "next/link";
import { useActionState } from "react";
import { businessTypes, businessTypeLabels } from "@/lib/business-types";
import type { OnboardingProgress } from "@/domain/onboarding";
import { advanceOnboarding } from "@/server/actions/onboarding";
import { useActionHydration } from "@/components/action-hydration";
import { BillingButton } from "@/components/billing-button";
const titles = [
  "Business type",
  "Business information",
  "Subscription",
  "Operating preferences",
  "Your team",
  "Customer payments",
];
export function ShopForm({
  progress,
  step,
  billingReady,
  profile,
}: {
  progress: OnboardingProgress;
  step: number;
  billingReady: boolean;
  profile?: {
    taxRateBps: number;
    laborSellRateCents: number;
    laborCostRateCents: number;
    partsTaxableDefault: boolean;
    laborTaxableDefault: boolean;
  };
}) {
  const [state, action, pending] = useActionState(advanceOnboarding, null);
  const ready = useActionHydration();
  const d = progress.draft;
  const automotive = d.businessType === "automotive";
  return (
    <section className="card" data-ux-ready={ready}>
      <p className="muted">Step {step} of 6</p>
      <h2 id="setup-step-title">{titles[step - 1]}</h2>
      <p className="muted">
        Your progress saves when you continue. Sign in on any device to resume.
      </p>
      {step === 3 && (
        <>
          <p>
            $49.99 per month after your 14-day free trial. Add a card in Stripe;
            promotional codes are accepted at checkout. Customer payment
            processing fees are separate.
          </p>
          {billingReady ? (
            <p className="notice ok">Your trial or subscription is active.</p>
          ) : (
            <BillingButton
              kind="start"
              label="Start 14-day free trial"
              primary={false}
            />
          )}
          <p>
            You can finish setup now. An active trial or subscription is
            required before adding customers or work.
          </p>
        </>
      )}
      {step === 5 && (
        <>
          <p>
            Working solo? You already have owner, advisor and technician access.
          </p>
          <Link className="btn secondary" href="/app/settings/team">
            Invite team members
          </Link>
          <p>
            Invite people and choose their roles, then return here to continue.
          </p>
        </>
      )}
      {step === 6 && (
        <>
          <p>
            Connect your business’s own Stripe account to receive customer
            invoice payments.
          </p>
          <Link className="btn secondary" href="/app/settings/payments">
            Set up customer payments
          </Link>
          <p>
            You can do this later in Settings. This is separate from your Shop
            Revenue subscription.
          </p>
        </>
      )}
      <form action={action} aria-labelledby="setup-step-title">
        <fieldset className="hydration-fields" disabled={!ready || pending}>
          <input type="hidden" name="step" value={step} />
          <input type="hidden" name="version" value={progress.version} />
          {step === 1 && (
            <>
              <label htmlFor="business-type">
                What kind of business do you run?
              </label>
              <select
                id="business-type"
                name="businessType"
                defaultValue={d.businessType ?? ""}
                required
              >
                <option value="">Choose your business type</option>
                {businessTypes.map((value) => (
                  <option key={value} value={value}>
                    {businessTypeLabels[value]}
                  </option>
                ))}
              </select>
              <label htmlFor="owner-name">Your name</label>
              <input
                id="owner-name"
                name="ownerName"
                autoComplete="name"
                defaultValue={d.ownerName ?? ""}
                maxLength={100}
                required
              />
              <label htmlFor="new-shop-name">Business name</label>
              <input
                id="new-shop-name"
                name="shopName"
                autoComplete="organization"
                defaultValue={d.shopName ?? ""}
                maxLength={200}
                required
              />
            </>
          )}
          {step === 2 && (
            <>
              <label htmlFor="setup-phone">Business phone</label>
              <input
                id="setup-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                defaultValue={d.phone ?? ""}
                maxLength={40}
              />
              <label htmlFor="setup-address">Street address</label>
              <input
                id="setup-address"
                name="addressLine1"
                autoComplete="street-address"
                defaultValue={d.addressLine1 ?? ""}
                maxLength={200}
              />
              <label htmlFor="setup-city">City</label>
              <input
                id="setup-city"
                name="city"
                autoComplete="address-level2"
                defaultValue={d.city ?? ""}
                maxLength={120}
              />
              <label htmlFor="setup-region">State</label>
              <input
                id="setup-region"
                name="region"
                autoComplete="address-level1"
                defaultValue={d.region ?? ""}
                maxLength={60}
              />
              <label htmlFor="setup-postal">ZIP / postal code</label>
              <input
                id="setup-postal"
                name="postalCode"
                autoComplete="postal-code"
                defaultValue={d.postalCode ?? ""}
                maxLength={20}
              />
              <label htmlFor="setup-timezone">Time zone</label>
              <select
                id="setup-timezone"
                name="timezone"
                defaultValue={d.timezone ?? "America/Chicago"}
              >
                {[
                  "America/New_York",
                  "America/Chicago",
                  "America/Denver",
                  "America/Phoenix",
                  "America/Los_Angeles",
                  "America/Anchorage",
                  "Pacific/Honolulu",
                ].map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </>
          )}
          {step === 4 && (
            <>
              <label htmlFor="setup-tax">Sales tax (%)</label>
              <input
                id="setup-tax"
                name="taxPercent"
                type="number"
                inputMode="decimal"
                min="0"
                max="20"
                step="0.01"
                defaultValue={(profile?.taxRateBps ?? 0) / 100}
                required
              />
              <label>
                <input name="taxConfirmed" type="checkbox" required /> I confirm
                this is the tax rate I chose for my business.
              </label>
              <label>
                <input
                  name="partsTaxableDefault"
                  type="checkbox"
                  defaultChecked={profile?.partsTaxableDefault ?? true}
                />{" "}
                {automotive ? "Parts" : "Materials"} are taxable by default
              </label>
              <label>
                <input
                  name="laborTaxableDefault"
                  type="checkbox"
                  defaultChecked={profile?.laborTaxableDefault ?? false}
                />{" "}
                Labor is taxable by default
              </label>
              <label htmlFor="setup-labor">Labor selling rate ($/hour)</label>
              <input
                id="setup-labor"
                name="laborSellRate"
                type="number"
                inputMode="decimal"
                min="0"
                max="1000000"
                step="0.01"
                defaultValue={(profile?.laborSellRateCents ?? 0) / 100}
                required
              />
              <label htmlFor="setup-labor-cost">Labor cost rate ($/hour)</label>
              <input
                id="setup-labor-cost"
                name="laborCostRate"
                type="number"
                inputMode="decimal"
                min="0"
                max="1000000"
                step="0.01"
                defaultValue={(profile?.laborCostRateCents ?? 0) / 100}
                required
              />
            </>
          )}
          <button className="btn primary" disabled={pending}>
            {pending
              ? "Saving…"
              : step === 6
                ? "Finish setup"
                : step === 5
                  ? "Continue with my team"
                  : "Save and continue"}
          </button>
          {step > 1 && (
            <Link className="btn secondary" href={`/start?step=${step - 1}`}>
              Back
            </Link>
          )}
          {step > 2 && <Link href="/app">Save the rest for later</Link>}
        </fieldset>
        {state && (
          <p className="notice error" role="status">
            {state.message}
          </p>
        )}
      </form>
    </section>
  );
}
