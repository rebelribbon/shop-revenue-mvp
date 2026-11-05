import Link from "next/link";
import { HydratedMain } from "@/components/hydrated-main";
import { ActionForm } from "@/components/action-form";
import { requireInternal } from "@/server/views/admin";
import {
  configurePlanAction,
  createDiscountCodeAction,
} from "@/server/actions/commercial-billing";
import { subscriptionPriceLabel } from "@/domain/billing";
import { TRIAL_DAYS } from "@/lib/billing";

export default async function PlatformBilling() {
  await requireInternal("admin");
  const price = await subscriptionPriceLabel();
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Subscription billing</h1>
      <p>
        Current offer {price ?? "awaiting configuration"}. New shops receive a{" "}
        {TRIAL_DAYS}-day trial. A card is required.
      </p>
      <section className="card">
        <h2>Set the monthly price</h2>
        <p>
          Each shop pays 3× your entered monthly app expenses. For example, $50
          of expenses sets a $150 monthly subscription. Include the full
          recurring cost of running Shop Revenue. This sets the price for new
          subscriptions. Existing subscriptions keep their agreed price.
        </p>
        <ActionForm
          action={configurePlanAction}
          submitLabel="Set price to 3× expenses"
          variant="primary"
          confirm="Set the monthly price for new subscriptions to three times the expenses entered?"
        >
          <label htmlFor="platform-cost">
            Monthly app operating expenses ($)
          </label>
          <input
            id="platform-cost"
            name="monthlyCost"
            type="number"
            min="0.01"
            step="0.01"
            max="100000"
            required
          />
        </ActionForm>
      </section>
      <section className="card">
        <h2>Create a discount code</h2>
        <p>
          Codes apply to Shop Revenue subscriptions. Expiration is at the end of
          the selected date in UTC.
        </p>
        <ActionForm
          action={createDiscountCodeAction}
          submitLabel="Create discount code"
          variant="secondary"
        >
          <label htmlFor="promo-code">Code</label>
          <input
            id="promo-code"
            name="code"
            required
            minLength={3}
            maxLength={40}
            pattern="[A-Za-z0-9-]+"
          />
          <label htmlFor="promo-percent">Discount (%)</label>
          <input
            id="promo-percent"
            name="percentOff"
            type="number"
            min="1"
            max="100"
            step="1"
            required
          />
          <label htmlFor="promo-duration">
            How long does the discount last?
          </label>
          <select id="promo-duration" name="duration">
            <option value="once">First invoice</option>
            <option value="forever">Every invoice</option>
          </select>
          <label htmlFor="promo-max">Maximum number of redemptions</label>
          <input
            id="promo-max"
            name="maxRedemptions"
            type="number"
            min="1"
            max="100000"
            step="1"
            required
          />
          <label htmlFor="promo-expires">Last redemption date (UTC)</label>
          <input id="promo-expires" name="expiresOn" type="date" required />
        </ActionForm>
      </section>
      <p>
        <Link href="/admin">Back to admin</Link>
      </p>
    </HydratedMain>
  );
}
