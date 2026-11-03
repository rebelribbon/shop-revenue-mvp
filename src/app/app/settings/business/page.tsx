import { formatPhone } from "@/lib/phone-format";
import { HydratedMain } from "@/components/hydrated-main";
import { businessTypes, businessTypeLabels } from "@/lib/business-types";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { withTenant } from "@/db/tenant";
import { getBusinessProfile } from "@/domain/business-profile";
import { updateBusinessProfileAction } from "@/server/actions/business";
import { setTargetMarginAction } from "@/server/actions/job-profit";
import { requireShopSession } from "@/server/views/shop";

const zones = [
  "America/Chicago",
  "America/New_York",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
];

export default async function BusinessSettingsPage() {
  const s = await requireShopSession("/app/settings/business");
  const profile = await withTenant(s.businessId, s.actor, (tx) =>
    getBusinessProfile(tx),
  );
  if (!profile) return null;
  const complete = Boolean(
    profile.legalName &&
    profile.phoneE164 &&
    profile.addressLine1 &&
    profile.city &&
    profile.region &&
    profile.postalCode &&
    profile.timezone,
  );
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Business profile</h1>
      <p>
        <Link href="/app/settings/payments">Set up online payments</Link>
      </p>
      <div className={`notice ${complete ? "ok" : ""}`}>
        {complete
          ? "Business setup is complete."
          : "Finish the basics below so appointments and future documents use the right business information."}
      </div>
      <div className="card">
        {s.role === "owner" ? (
          <ActionForm
            variant="primary"
            action={updateBusinessProfileAction}
            submitLabel="Save business profile"
            successText="Business profile updated."
          >
            <label htmlFor="businessType">
              What line of business are you in?
            </label>
            <select
              key={profile.businessType}
              id="businessType"
              name="businessType"
              defaultValue={profile.businessType}
            >
              {businessTypes.map((type) => (
                <option key={type} value={type}>
                  {businessTypeLabels[type]}
                </option>
              ))}
            </select>
            <p className="muted">
              Automotive uses vehicles. Home services use properties and
              equipment. Customers, costs, estimates, invoices and payments stay
              together. Changing this choice keeps existing records.
            </p>
            <label htmlFor="legalName">Legal business name</label>
            <input
              id="legalName"
              name="legalName"
              required
              maxLength={200}
              defaultValue={profile.legalName}
            />
            <label htmlFor="dba">Business name / DBA</label>
            <input
              id="dba"
              name="dba"
              maxLength={200}
              defaultValue={profile.dba ?? ""}
            />
            <label htmlFor="phone">Business phone</label>
            <input
              id="phone"
              name="phone"
              type="tel"
              defaultValue={formatPhone(profile.phoneE164)}
            />
            <label htmlFor="addressLine1">Street address</label>
            <input
              id="addressLine1"
              name="addressLine1"
              maxLength={200}
              defaultValue={profile.addressLine1 ?? ""}
            />
            <label htmlFor="addressLine2">Suite / unit</label>
            <input
              id="addressLine2"
              name="addressLine2"
              maxLength={200}
              defaultValue={profile.addressLine2 ?? ""}
            />
            <div className="form-grid">
              <div>
                <label htmlFor="city">City</label>
                <input
                  id="city"
                  name="city"
                  maxLength={120}
                  defaultValue={profile.city ?? ""}
                />
              </div>
              <div>
                <label htmlFor="region">State</label>
                <input
                  id="region"
                  name="region"
                  maxLength={60}
                  defaultValue={profile.region ?? "TX"}
                />
              </div>
              <div>
                <label htmlFor="postalCode">ZIP</label>
                <input
                  id="postalCode"
                  name="postalCode"
                  maxLength={20}
                  defaultValue={profile.postalCode ?? ""}
                />
              </div>
            </div>
            <h2>Hourly labor rates</h2>
            <label htmlFor="laborSellRate">Customer labor rate ($/hour)</label>
            <input
              id="laborSellRate"
              name="laborSellRate"
              type="number"
              min="0"
              max="1000000"
              step="0.01"
              defaultValue={profile.laborSellRateCents / 100}
            />
            <label htmlFor="laborCostRate">Your labor cost ($/hour)</label>
            <input
              id="laborCostRate"
              name="laborCostRate"
              type="number"
              min="0"
              max="1000000"
              step="0.01"
              defaultValue={profile.laborCostRateCents / 100}
            />
            <p className="muted">
              New jobs start with these rates. Existing jobs keep their prices.
            </p>
            <h2>Tax defaults</h2>
            <label htmlFor="taxPercent">Default tax rate (%)</label>
            <input
              id="taxPercent"
              name="taxPercent"
              type="number"
              min="0"
              max="20"
              step="0.01"
              required
              defaultValue={profile.taxRateBps / 100}
            />
            <label htmlFor="partsTaxableDefault">
              Parts / materials taxable by default
            </label>
            <select
              id="partsTaxableDefault"
              name="partsTaxableDefault"
              defaultValue={String(profile.partsTaxableDefault)}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
            <label htmlFor="laborTaxableDefault">
              Labor taxable by default
            </label>
            <select
              id="laborTaxableDefault"
              name="laborTaxableDefault"
              defaultValue={String(profile.laborTaxableDefault)}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
            <p className="muted">
              Enter the combined rate for your shop’s address (state + county +
              city). Your state’s revenue department website has a rate lookup.
              What’s taxable differs by state — for example, many states tax
              parts but not repair labor, and some tax both. Ask your accountant
              if you’re not sure. You can still switch tax on or off for each
              line on a job.
            </p>
            <label>
              <input
                type="checkbox"
                name="taxConfirmed"
                id="taxConfirmed"
                required={!profile.taxRateConfirmedAt}
              />
              <span>
                I chose this tax rate and these defaults for my business. I’m
                responsible for charging and paying the right sales tax.
              </span>
            </label>
            <p className="muted">
              {profile.taxRateConfirmedAt
                ? `Last confirmed ${profile.taxRateConfirmedAt.toLocaleDateString("en-US", { timeZone: profile.timezone, dateStyle: "medium" })}. Tick the box again if you change the rate or defaults.`
                : "Not confirmed yet."}{" "}
              Saved estimates and invoices keep their original tax.
            </p>
            <label htmlFor="timezone">Timezone</label>
            <select
              id="timezone"
              name="timezone"
              defaultValue={profile.timezone}
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace("America/", "").replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </ActionForm>
        ) : (
          <div>
            <p>
              <strong>{profile.dba || profile.legalName}</strong>
            </p>
            <p>{formatPhone(profile.phoneE164) || "No phone"}</p>
            <p>
              {[
                profile.addressLine1,
                profile.addressLine2,
                profile.city,
                profile.region,
                profile.postalCode,
              ]
                .filter(Boolean)
                .join(", ") || "No address"}
            </p>
            <p className="muted">
              Only the owner can edit the business profile.
            </p>
          </div>
        )}
      </div>
      {s.role === "owner" && s.actor.type !== "support" && (
        <section className="card" aria-label="Target profit">
          <h2>Target profit per job</h2>
          <p className="muted">
            Jobs below this show a warning before you send the estimate.
          </p>
          <ActionForm
            action={setTargetMarginAction}
            submitLabel="Save target"
            variant="secondary"
          >
            <label htmlFor="target-margin">Target profit (%)</label>
            <input
              id="target-margin"
              name="percent"
              type="number"
              inputMode="decimal"
              min={0}
              max={95}
              step={1}
              required
              defaultValue={(
                (profile?.targetMarginBps ?? 4000) / 100
              ).toString()}
            />
          </ActionForm>
        </section>
      )}
    </HydratedMain>
  );
}
