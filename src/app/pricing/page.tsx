import Link from "next/link";
import { HydratedMain } from "@/components/hydrated-main";
import { subscriptionPriceLabel } from "@/domain/billing";
import { publicSignupEnabled, TRIAL_DAYS } from "@/lib/billing";

export const dynamic = "force-dynamic";

export default async function Pricing() {
  const price = await subscriptionPriceLabel();
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Run your repair shop with Shop Revenue</h1>
      <p>
        Keep customers, visits, estimates, approved work and payments together.
      </p>
      <section className="card">
        <h2>One subscription per shop</h2>
        {price ? (
          <p className="money-total">{price}</p>
        ) : (
          <p>Monthly pricing is being configured.</p>
        )}
        <p>
          {TRIAL_DAYS} days free. Add a card to start. Cancel before your trial
          ends to avoid a subscription charge. Discount codes can be entered at
          checkout.
        </p>
        <ul>
          <li>Customers, vehicles and scheduling</li>
          <li>Estimates and customer approvals</li>
          <li>Assigned jobs, inspections and time tracking</li>
          <li>Invoices, payments, expenses and reports</li>
          <li>Owner access plus up to 10 staff and technician logins</li>
        </ul>
        {publicSignupEnabled() && price ? (
          <Link className="btn primary" data-page-primary href="/sign-up">
            Start your free trial
          </Link>
        ) : (
          <p>New subscriptions will open when billing setup is complete.</p>
        )}
      </section>
      <p>
        <Link href="/sign-in">Sign in to your shop</Link>
      </p>
    </HydratedMain>
  );
}
