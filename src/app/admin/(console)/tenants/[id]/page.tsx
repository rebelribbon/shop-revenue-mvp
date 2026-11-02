import { HydratedMain } from "@/components/hydrated-main";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { withAdmin, withAdminTenant } from "@/db/admin";
import { business } from "@/db/schema";
import { listTeam } from "@/domain/membership";
import { getShopSubscription } from "@/domain/billing";
import {
  resendOwnerInviteAction,
  resetStaffAction,
  setShopCompedAction,
  startViewAsAction,
} from "@/server/actions/admin";
import { requireInternal } from "@/server/views/admin";

export default async function TenantDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireInternal();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [b] = await withAdmin({ internalUserId: me.id }, (tx) =>
    tx.select().from(business).where(eq(business.id, id)),
  );
  if (!b) notFound();
  const { team, sub } = await withAdminTenant(
    b.id,
    { internalUserId: me.id },
    async (tx) => ({
      team: await listTeam(tx),
      sub: await getShopSubscription(tx),
    }),
  );
  const name = b.dba || b.legalName;
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>{name}</h1>
      <div className="card">
        <p>
          Status: <span className="pill">{b.status}</span> · Timezone{" "}
          {b.timezone} · Jurisdiction {b.jurisdictionCode}
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.id}>
                  <td>{m.role}</td>
                  <td>{m.status}</td>
                  <td>
                    {m.role === "owner" && m.status === "invited" && (
                      <ActionForm
                        action={resendOwnerInviteAction}
                        hidden={{
                          businessId: b.id,
                          membershipId: m.id,
                          businessName: name,
                        }}
                        submitLabel="Resend owner invite"
                        variant="secondary"
                      />
                    )}
                    {m.role === "staff" && (
                      <ActionForm
                        action={resetStaffAction}
                        hidden={{ businessId: b.id, membershipId: m.id }}
                        submitLabel="Remove staff login (owner request)"
                        variant="danger"
                        confirm="Only do this when the owner asked. It is audited."
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h2>Billing</h2>
        <p>
          Subscription: <span className="pill">{sub?.status ?? "none"}</span>
          {sub?.comped && (
            <>
              {" "}
              · <span className="pill">free access</span>{" "}
              {sub.compedReason && <>({sub.compedReason})</>}
            </>
          )}
        </p>
        {sub?.comped ? (
          <ActionForm
            action={setShopCompedAction}
            hidden={{ businessId: b.id, comped: "false" }}
            submitLabel="End free access (bill normally)"
            variant="secondary"
          />
        ) : (
          <ActionForm
            action={setShopCompedAction}
            hidden={{ businessId: b.id, comped: "true" }}
            submitLabel="Give free access"
            variant="secondary"
          >
            <label htmlFor="comp-reason">Why (required)</label>
            <input id="comp-reason" name="reason" required maxLength={500} />
          </ActionForm>
        )}
      </div>
      <div className="card">
        <h2>View as this shop (read-only, 60 minutes)</h2>
        <p className="muted">
          The owner sees this session, with your name and reason, in their
          support access log.
        </p>
        <ActionForm
          variant="primary"
          action={startViewAsAction}
          hidden={{ businessId: b.id }}
          submitLabel="Start view-as"
        >
          <label htmlFor="reason">Reason (required)</label>
          <textarea
            id="reason"
            name="reason"
            required
            minLength={10}
            maxLength={500}
          />
        </ActionForm>
      </div>
    </HydratedMain>
  );
}
