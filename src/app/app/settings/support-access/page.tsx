import { desc, eq } from "drizzle-orm";
import { auditEvent } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { listSupportAccess } from "@/domain/support";
import { requireOwnerView } from "@/server/views/shop";

const fmt = (d: Date | null) =>
  d
    ? d.toLocaleString("en-US", {
        timeZone: "America/Chicago",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const minutes = (a: Date, b: Date | null) =>
  b
    ? `${Math.max(1, Math.round((b.getTime() - a.getTime()) / 60000))} min`
    : "in progress";

// S29: Owner only. View-as sessions (who, when, reason, duration) and recent audit events.
export default async function SupportAccessPage() {
  const s = await requireOwnerView("/app/settings/support-access");
  const [sessions, audits] = await withTenant(
    s.businessId,
    s.actor,
    async (tx) =>
      [
        await listSupportAccess(tx),
        await tx
          .select()
          .from(auditEvent)
          .where(eq(auditEvent.businessId, s.businessId))
          .orderBy(desc(auditEvent.occurredAt))
          .limit(50),
      ] as const,
  );
  return (
    <main id="main-content" tabIndex={-1}>
      <h1>Support access</h1>
      <div className="card table-wrap">
        {sessions.length === 0 ? (
          <p>Our team has not accessed your account.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Who</th>
                <th>When</th>
                <th>Reason</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((x) => (
                <tr key={x.id}>
                  <td>{x.adminDisplayName}</td>
                  <td>{fmt(x.startedAt)}</td>
                  <td>{x.reason}</td>
                  <td>
                    {minutes(x.startedAt, x.endedAt)}
                    {x.endReason === "expired" ? " (timed out)" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <h2>Recent account activity</h2>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>What</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {audits.map((a) => (
              <tr key={a.id}>
                <td>{fmt(a.occurredAt)}</td>
                <td>{a.action}</td>
                <td>{a.actorType}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
