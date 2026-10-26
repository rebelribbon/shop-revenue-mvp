import { ActionForm } from "@/components/action-form";
import { withTenant } from "@/db/tenant";
import { getBusinessProfile } from "@/domain/business-profile";
import { updateBusinessProfileAction } from "@/server/actions/business";
import { requireShopSession } from "@/server/views/shop";

const zones = ["America/Chicago", "America/New_York", "America/Denver", "America/Phoenix", "America/Los_Angeles"];

export default async function BusinessSettingsPage() {
  const s = await requireShopSession("/app/settings/business");
  const profile = await withTenant(s.businessId, s.actor, (tx) => getBusinessProfile(tx));
  if (!profile) return null;
  const complete = Boolean(profile.legalName && profile.phoneE164 && profile.addressLine1 && profile.city && profile.region && profile.postalCode && profile.timezone);
  return (
    <main>
      <h1>Business profile</h1>
      <div className={`notice ${complete ? "ok" : ""}`}>
        {complete ? "Shop setup is complete." : "Finish the basics below so appointments and future documents use the right shop information."}
      </div>
      <div className="card">
        {s.role === "owner" ? (
          <ActionForm action={updateBusinessProfileAction} submitLabel="Save business profile" successText="Business profile updated.">
            <label htmlFor="legalName">Legal business name</label><input id="legalName" name="legalName" required maxLength={200} defaultValue={profile.legalName} />
            <label htmlFor="dba">Shop name / DBA</label><input id="dba" name="dba" maxLength={200} defaultValue={profile.dba ?? ""} />
            <label htmlFor="phone">Shop phone</label><input id="phone" name="phone" type="tel" defaultValue={profile.phoneE164 ?? ""} />
            <label htmlFor="addressLine1">Street address</label><input id="addressLine1" name="addressLine1" maxLength={200} defaultValue={profile.addressLine1 ?? ""} />
            <label htmlFor="addressLine2">Suite / unit</label><input id="addressLine2" name="addressLine2" maxLength={200} defaultValue={profile.addressLine2 ?? ""} />
            <div className="form-grid">
              <div><label htmlFor="city">City</label><input id="city" name="city" maxLength={120} defaultValue={profile.city ?? ""} /></div>
              <div><label htmlFor="region">State</label><input id="region" name="region" maxLength={60} defaultValue={profile.region ?? "TX"} /></div>
              <div><label htmlFor="postalCode">ZIP</label><input id="postalCode" name="postalCode" maxLength={20} defaultValue={profile.postalCode ?? ""} /></div>
            </div>
            <label htmlFor="timezone">Timezone</label>
            <select id="timezone" name="timezone" defaultValue={profile.timezone}>{zones.map((z) => <option key={z} value={z}>{z.replace("America/", "").replaceAll("_", " ")}</option>)}</select>
          </ActionForm>
        ) : (
          <div>
            <p><strong>{profile.dba || profile.legalName}</strong></p>
            <p>{profile.phoneE164 || "No phone"}</p>
            <p>{[profile.addressLine1, profile.addressLine2, profile.city, profile.region, profile.postalCode].filter(Boolean).join(", ") || "No address"}</p>
            <p className="muted">Only the owner can edit the business profile.</p>
          </div>
        )}
      </div>
    </main>
  );
}
