import { formatPhone } from "@/lib/phone-format";
import { HydratedMain } from "@/components/hydrated-main";
import { ActionForm } from "@/components/action-form";
import { withTenant } from "@/db/tenant";
import {
  inviteDeliveryStatus,
  listTeam,
  MAX_TEAM_SEATS,
} from "@/domain/membership";
import {
  inviteStaffAction,
  removeStaffAction,
  resendInviteAction,
} from "@/server/actions/team";
import { requireShopSession } from "@/server/views/shop";

export default async function TeamPage() {
  const s = await requireShopSession("/app/settings/team");
  const { team, delivery, expired } = await withTenant(
    s.businessId,
    s.actor,
    async (tx) => {
      const team = await listTeam(tx);
      const invited = team.filter((m) => m.status === "invited");
      const delivery = await inviteDeliveryStatus(
        tx,
        invited.map((m) => m.id),
      );
      const expired = new Set(
        invited
          .filter((m) => m.inviteExpiresAt && m.inviteExpiresAt < new Date())
          .map((m) => m.id),
      );
      return { team, delivery, expired };
    },
  );
  const statusLabel = (m: (typeof team)[number]) => {
    if (m.status !== "invited") return { text: "Active", warn: false };
    if (delivery.get(m.id) === "failed")
      return { text: "Not sent – resend", warn: true };
    if (expired.has(m.id))
      return { text: "Invite expired – resend", warn: true };
    if (delivery.get(m.id) === "sent")
      return { text: "Invite sent", warn: false };
    return { text: "Invited", warn: false };
  };
  const roleLabel = (role: string) => {
    if (role === "owner") return "Owner";
    if (role === "technician") return "Technician";
    return "Staff";
  };
  const isOwner = s.role === "owner";
  const teamSeats = team.filter(
    (m) => m.role === "staff" || m.role === "technician",
  ).length;
  const seatsLeft = MAX_TEAM_SEATS - teamSeats;
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
                      formatPhone(m.phoneE164 ?? m.invitePhoneE164)}
                  </span>
                </td>
                <td>{roleLabel(m.role)}</td>
                <td>
                  <span
                    className={statusLabel(m).warn ? "pill pill-warn" : "pill"}
                  >
                    {statusLabel(m).text}
                  </span>
                </td>
                {isOwner && (
                  <td>
                    {(m.role === "staff" || m.role === "technician") &&
                      m.status === "invited" && (
                        <ActionForm
                          action={resendInviteAction}
                          hidden={{ membershipId: m.id }}
                          submitLabel="Resend invite"
                          variant="secondary"
                        />
                      )}
                    {(m.role === "staff" || m.role === "technician") && (
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
      {isOwner && seatsLeft > 0 && (
        <div className="card">
          <h2>Invite a teammate</h2>
          <p className="muted">
            Each person gets their own login. {seatsLeft} of {MAX_TEAM_SEATS}{" "}
            team logins left. Staff run the front office; technicians work assigned jobs.
          </p>
          <ActionForm action={inviteStaffAction} submitLabel="Send invite">
            <label htmlFor="name">Name</label>
            <input id="name" name="name" required maxLength={100} />
            <label htmlFor="role">Role</label>
            <select id="role" name="role" defaultValue="staff" required>
              <option value="staff">Staff (front office)</option>
              <option value="technician">Technician (assigned jobs)</option>
            </select>
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" />
            <label htmlFor="phone">or mobile number</label>
            <input id="phone" name="phone" type="tel" inputMode="tel" />
          </ActionForm>
        </div>
      )}
      {isOwner && seatsLeft <= 0 && (
        <p className="muted">
          You have {MAX_TEAM_SEATS} team logins, the most allowed. Remove one
          to invite someone else.
        </p>
      )}
    </HydratedMain>
  );
}
