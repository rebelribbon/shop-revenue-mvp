import { HydratedMain } from "@/components/hydrated-main";
import { ActionForm } from "@/components/action-form";
import { withTenant } from "@/db/tenant";
import { listTeam } from "@/domain/membership";
import {
  inviteStaffAction,
  removeStaffAction,
  resendInviteAction,
} from "@/server/actions/team";
import { requireShopSession } from "@/server/views/shop";

export default async function TeamPage() {
  const s = await requireShopSession("/app/settings/team");
  const team = await withTenant(s.businessId, s.actor, (tx) => listTeam(tx));
  const isOwner = s.role === "owner";
  const staffSeatUsed = team.some((m) => m.role === "staff");
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Team</h1>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              {isOwner && <th />}
            </tr>
          </thead>
          <tbody>
            {team.map((m) => (
              <tr key={m.id}>
                <td>
                  {m.displayName ?? m.inviteName ?? "—"}
                  <br />
                  <span className="muted">
                    {m.email ??
                      m.inviteEmail ??
                      m.phoneE164 ??
                      m.invitePhoneE164}
                  </span>
                </td>
                <td>{m.role === "owner" ? "Owner" : "Staff"}</td>
                <td>
                  <span className="pill">
                    {m.status === "invited" ? "Invite sent" : "Active"}
                  </span>
                </td>
                {isOwner && (
                  <td>
                    {m.role === "staff" && m.status === "invited" && (
                      <ActionForm
                        action={resendInviteAction}
                        hidden={{ membershipId: m.id }}
                        submitLabel="Resend invite"
                        variant="secondary"
                      />
                    )}
                    {m.role === "staff" && (
                      <ActionForm
                        action={removeStaffAction}
                        hidden={{ membershipId: m.id }}
                        submitLabel="Remove"
                        variant="danger"
                        confirm="Remove this login? They lose access on their next click."
                      />
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isOwner && !staffSeatUsed && (
        <div className="card">
          <h2>Invite one teammate</h2>
          <ActionForm action={inviteStaffAction} submitLabel="Send invite">
            <label htmlFor="name">Name</label>
            <input id="name" name="name" required maxLength={100} />
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" />
            <label htmlFor="phone">or mobile number</label>
            <input id="phone" name="phone" type="tel" inputMode="tel" />
          </ActionForm>
        </div>
      )}
      {isOwner && staffSeatUsed && (
        <p className="muted">
          Your plan includes one staff login. Remove the current one to invite
          someone else.
        </p>
      )}
    </HydratedMain>
  );
}
