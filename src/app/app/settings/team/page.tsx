import { formatPhone } from "@/lib/phone-format";
import { notFound } from "next/navigation";
import { HydratedMain } from "@/components/hydrated-main";
import { ActionForm } from "@/components/action-form";
import { withTenant } from "@/db/tenant";
import {
  inviteDeliveryStatus,
  listTeam,
  canManageTeam,
  MAX_TEAM_SEATS,
} from "@/domain/membership";
import {
  inviteStaffAction,
  changeTeamAccessAction,
  removeStaffAction,
  resendInviteAction,
} from "@/server/actions/team";
import { requireShopSession } from "@/server/views/shop";
import { handoffPingsOn } from "@/domain/handoff-pings";
import { setHandoffPingsAction } from "@/server/actions/assignments";

export default async function TeamPage() {
  const s = await requireShopSession("/app/settings/team");
  const { team, delivery, expired, pingsOn, canManage } = await withTenant(
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
      return {
        team,
        delivery,
        expired,
        pingsOn: await handoffPingsOn(tx),
        canManage: await canManageTeam(tx),
      };
    },
  );
  if (!canManage) notFound();
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
    if (role === "owner") return "Owner · Advisor · Technician";
    if (role === "technician") return "Technician";
    return "Service advisor";
  };
  const canEdit = canManage;
  const teamSeats = team.filter(
    (m) => m.role === "staff" || m.role === "technician",
  ).length;
  const seatsLeft = MAX_TEAM_SEATS - teamSeats;
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Team</h1>
      <p className="muted">
        One login can cover more than one responsibility. Your owner login
        includes management, service advisor and technician access. Assign
        yourself in both RO dropdowns to test the complete workflow.
      </p>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              {canEdit && <th />}
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
                <td>{m.canManageTeam ? "Manager" : roleLabel(m.role)}</td>
                <td>
                  <span
                    className={statusLabel(m).warn ? "pill pill-warn" : "pill"}
                  >
                    {statusLabel(m).text}
                  </span>
                </td>
                {canEdit && (
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
                    {(m.role === "staff" || m.role === "technician") &&
                      m.status === "active" &&
                      m.userId !== s.userId && (
                        <ActionForm
                          action={changeTeamAccessAction}
                          hidden={{ membershipId: m.id }}
                          submitLabel="Save role"
                          variant="secondary"
                        >
                          <label htmlFor={`team-role-${m.id}`}>
                            Access role
                          </label>
                          <select
                            id={`team-role-${m.id}`}
                            name="role"
                            defaultValue={
                              m.canManageTeam
                                ? "manager"
                                : m.role === "technician"
                                  ? "technician"
                                  : "advisor"
                            }
                          >
                            <option value="advisor">Service advisor</option>
                            <option value="technician">Technician</option>
                            <option value="manager">Manager</option>
                          </select>
                        </ActionForm>
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
      {canEdit && seatsLeft > 0 && (
        <div className="card">
          <h2>Invite a teammate</h2>
          <p className="muted">
            Each person gets their own login. {seatsLeft} of {MAX_TEAM_SEATS}{" "}
            team logins left. Staff run the front office; technicians work
            assigned jobs. Managers can assign work and manage access.
          </p>
          <ActionForm action={inviteStaffAction} submitLabel="Send invite">
            <label htmlFor="name">Name</label>
            <input id="name" name="name" required maxLength={100} />
            <label htmlFor="role">Role</label>
            <select id="role" name="role" defaultValue="staff" required>
              <option value="staff">
                Service advisor (assigned customers and ROs)
              </option>
              <option value="technician">Technician (assigned ROs only)</option>
              <option value="manager">Manager (team and assignments)</option>
            </select>
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" />
            <label htmlFor="phone">or mobile number</label>
            <input id="phone" name="phone" type="tel" inputMode="tel" />
          </ActionForm>
        </div>
      )}
      {canEdit && seatsLeft <= 0 && (
        <p className="muted">
          You have {MAX_TEAM_SEATS} team logins, the most allowed. Remove one to
          invite someone else.
        </p>
      )}
      {canEdit && (
        <section className="card reminder-settings">
          <h2>Handoff emails</h2>
          <p className="muted">
            Email whoever the RO passes to: the technician when it’s assigned
            and again when the customer approves the work, and the service
            advisor when the inspection is in and when the work is finished and
            ready to invoice. The work always shows in Tasks either way.
          </p>
          <ActionForm
            action={setHandoffPingsAction}
            submitLabel="Save handoff emails"
            variant="secondary"
          >
            <fieldset className="reminder-switch">
              <legend>Email team members about handed-off work</legend>
              <label>
                <input
                  type="radio"
                  name="on"
                  value="true"
                  defaultChecked={pingsOn}
                />
                On
              </label>
              <label>
                <input
                  type="radio"
                  name="on"
                  value="false"
                  defaultChecked={!pingsOn}
                />
                Off
              </label>
            </fieldset>
          </ActionForm>
        </section>
      )}
    </HydratedMain>
  );
}
