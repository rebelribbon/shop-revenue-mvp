import { HydratedMain } from "@/components/hydrated-main";
import { getBusinessProfile } from "@/domain/business-profile";
import { withTenant } from "@/db/tenant";
import { isAutomotive } from "@/lib/business-types";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { createCustomerAction } from "@/server/actions/customers";
import { requireShopSession } from "@/server/views/shop";
import { LEAD_SOURCES } from "@/lib/lead-sources";
export default async function NewCustomerPage() {
  const s = await requireShopSession("/app/customers/new");
  const profile = await withTenant(s.businessId, s.actor, (tx) =>
    getBusinessProfile(tx),
  );
  const auto = isAutomotive(profile?.businessType ?? "automotive");
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <p>
        <Link href="/app/customers">← Customers</Link>
      </p>
      <h1>New customer</h1>
      <p>
        {auto
          ? "Add contact details first, then add the customer’s vehicle."
          : "Add contact details first, then add service properties and equipment."}
      </p>
      <div className="card" id="new-customer">
        <h2 style={{ marginTop: 0 }}>New customer</h2>
        <ActionForm
          variant="primary"
          action={createCustomerAction}
          submitLabel="Add customer"
        >
          <label htmlFor="firstName">First name</label>
          <input id="firstName" name="firstName" maxLength={100} />
          <label htmlFor="lastName">Last name</label>
          <input id="lastName" name="lastName" maxLength={100} />
          <label htmlFor="phone">Mobile number</label>
          <input id="phone" name="phone" type="tel" inputMode="tel" />
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" />
          <label htmlFor="addressLine1">Street address (optional)</label>
          <input
            id="addressLine1"
            name="addressLine1"
            maxLength={200}
            autoComplete="street-address"
          />
          <label htmlFor="city">City</label>
          <input id="city" name="city" maxLength={100} />
          <label htmlFor="region">State</label>
          <input id="region" name="region" maxLength={50} />
          <label htmlFor="postalCode">ZIP</label>
          <input
            id="postalCode"
            name="postalCode"
            maxLength={20}
            inputMode="numeric"
          />
          <label htmlFor="leadSource">How did they find you?</label>
          <select id="leadSource" name="leadSource" defaultValue="">
            <option value="">Not sure / skip</option>
            {LEAD_SOURCES.filter(([k]) => k !== "booking").map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <label htmlFor="leadSourceDetail">
            Who referred them? <span className="muted">(optional)</span>
          </label>
          <input
            id="leadSourceDetail"
            name="leadSourceDetail"
            maxLength={200}
          />
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" rows={4} maxLength={5000} />
        </ActionForm>
      </div>
    </HydratedMain>
  );
}
