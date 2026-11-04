import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { formatMoney } from "@/components/estimate-document";
import { HydratedMain } from "@/components/hydrated-main";
import { withTenant } from "@/db/tenant";
import { myDay } from "@/domain/my-day";
import { assignVisitAction } from "@/server/actions/assignments";
import { setAppointmentStatusAction } from "@/server/actions/appointments";
import { startClockAction, stopClockAction } from "@/server/actions/job-profit";
import { requireShopSession } from "@/server/views/shop";

const STATUS: Record<string, string> = {
  in_progress: "In the bay",
  won: "Approved, not scheduled",
  scheduled: "Approved",
  draft: "Needs a quote",
};

function clockText(started: Date) {
  const m = Math.max(0, Math.floor((Date.now() - started.getTime()) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export default async function MyDayPage() {
  const s = await requireShopSession("/app/my-day");
  const me = s.actor.type === "user" ? s.actor.id : null;
  const day = me
    ? await withTenant(s.businessId, s.actor, (tx) => myDay(tx, me))
    : null;
  const canAct = s.actor.type !== "support" && !!me;
  const tz = day?.timezone ?? "America/Chicago";
  const time = (d: Date) =>
    d.toLocaleTimeString("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
    });
  const date = new Date().toLocaleDateString("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const first = day?.jobs[0];
  const empty = !!day && !day.jobs.length && !day.visits.length;

  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>My day</h1>
      <p className="muted">{date}</p>
      {!day ? (
        <p>My day shows the jobs and visits given to a team member.</p>
      ) : (
        <>
          {day.clock ? (
            <section className="clock-banner" aria-label="Your clock">
              <p>
                Clock running on <strong>{day.clock.jobTitle}</strong> ·{" "}
                {clockText(day.clock.startedAt)}
              </p>
              {canAct && (
                <ActionForm
                  action={stopClockAction}
                  submitLabel="■ Stop clock"
                  variant="primary"
                />
              )}
            </section>
          ) : (
            first &&
            canAct && (
              <ActionForm
                action={startClockAction}
                hidden={{ jobId: first.id }}
                submitLabel={`▶ Start: ${first.title}`}
                variant="primary"
              />
            )
          )}

          {empty && (
            <p className="notice">
              Nothing is on your plate yet. When the owner puts you on a job or
              visit, it shows up here.
            </p>
          )}

          {day.visits.length > 0 && (
            <section className="card" aria-label="Your visits today">
              <h2>Your visits today ({day.visits.length})</h2>
              {day.visits.map((v) => (
                <div className="overview-row" key={v.id}>
                  <Link
                    href={
                      v.planJobId
                        ? `/app/jobs?job=${v.planJobId}`
                        : `/app/customers/${v.customerId}`
                    }
                  >
                    <strong>{time(v.startsAt)}</strong> {v.customerName} ·{" "}
                    {v.reason || "Visit"}
                    {v.serviceAddress && (
                      <span className="muted"> · {v.serviceAddress}</span>
                    )}
                  </Link>
                  <span className="visit-actions">
                    {v.serviceAddress && (
                      <a
                        className="btn secondary"
                        href={`https://maps.google.com/?q=${encodeURIComponent(v.serviceAddress)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Directions
                      </a>
                    )}
                    {canAct && (
                      <ActionForm
                        action={setAppointmentStatusAction}
                        hidden={{ appointmentId: v.id, status: "completed" }}
                        submitLabel="Done"
                        variant="secondary"
                      />
                    )}
                  </span>
                </div>
              ))}
            </section>
          )}

          {day.jobs.length > 0 && (
            <section className="card" aria-label="Your jobs">
              <h2>Your jobs ({day.jobs.length})</h2>
              <ul className="my-jobs">
                {day.jobs.map((j) => (
                  <li key={j.id}>
                    <Link href={`/app/jobs?job=${j.id}`}>
                      <strong>{j.title}</strong>
                      <span className="muted">
                        {[j.customerName, j.label].filter(Boolean).join(" · ")}
                      </span>
                      <span>
                        {STATUS[j.status] ?? "Open"}
                        {j.amountCents > 0 &&
                          ` · ${formatMoney(j.amountCents)}`}
                      </span>
                    </Link>
                    <span className="visit-actions">
                      {canAct && day.clock?.jobId !== j.id && j !== first && (
                        <ActionForm
                          action={startClockAction}
                          hidden={{ jobId: j.id }}
                          submitLabel={
                            day.clock ? "▶ Switch clock here" : "▶ Start clock"
                          }
                          variant="secondary"
                        />
                      )}
                      <Link
                        className="btn secondary"
                        href={`/app/jobs?job=${j.id}&tab=inspection`}
                      >
                        Inspection
                      </Link>
                      <Link
                        className="btn secondary"
                        href={`/app/jobs?job=${j.id}&add=photo`}
                      >
                        + Photo
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {day.openVisits.length > 0 && (
            <section className="card" aria-label="Open visits today">
              <h2>Nobody’s on these yet ({day.openVisits.length})</h2>
              {day.openVisits.map((v) => (
                <div className="overview-row" key={v.id}>
                  <span>
                    <strong>{time(v.startsAt)}</strong> {v.customerName} ·{" "}
                    {v.reason || "Visit"}
                  </span>
                  {canAct && (
                    <ActionForm
                      action={assignVisitAction}
                      hidden={{ appointmentId: v.id, userId: me! }}
                      submitLabel="Take it"
                      variant="secondary"
                    />
                  )}
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </HydratedMain>
  );
}
