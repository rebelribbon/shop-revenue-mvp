import { HydratedMain } from "@/components/hydrated-main";
import { ActionForm } from "@/components/action-form";
import { withTenant } from "@/db/tenant";
import { getInspectionMediaRequirements } from "@/domain/inspection-media-settings";
import { saveInspectionMediaRequirementsAction } from "@/server/actions/inspection-media-settings";
import { requireShopSession } from "@/server/views/shop";
import Link from "next/link";

export default async function InspectionSettingsPage() {
  const session = await requireShopSession("/app/settings/inspection");
  const settings = await withTenant(
    session.businessId,
    session.actor,
    getInspectionMediaRequirements,
  );
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <Link href="/app/settings">← Settings</Link>
      <h1>Inspection requirements</h1>
      <p className="muted">
        Technicians still record every inspection result. Photos are only
        requested for Caution or Fail findings. Both requirements start off.
      </p>
      {session.role === "owner" ? (
        <div className="card">
          <ActionForm
            action={saveInspectionMediaRequirementsAction}
            submitLabel="Save inspection requirements"
            successText="Inspection requirements saved."
          >
            <label>
              <input
                type="checkbox"
                name="photos"
                defaultChecked={settings.photos}
              />
              Require a photo for every Caution or Fail finding before
              submission
            </label>
            <label>
              <input
                type="checkbox"
                name="videos"
                defaultChecked={settings.videos}
              />
              Require one technician summary video before submission
            </label>
            <p className="muted">
              Media is private until an advisor explicitly selects it for the
              customer. Uploads must finish successfully to satisfy these rules.
            </p>
          </ActionForm>
        </div>
      ) : (
        <p className="muted">
          Only the shop owner can change these settings. Photos:{" "}
          {settings.photos ? "required" : "optional"}. Video:{" "}
          {settings.videos ? "required" : "optional"}.
        </p>
      )}
    </HydratedMain>
  );
}
