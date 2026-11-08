import { everyLabel, type Repeat } from "@/lib/service-plans";
import { HydratedMain } from "@/components/hydrated-main";
import Link from "next/link";
import { withTenant } from "@/db/tenant";
import { listTechs } from "@/domain/assignments";
import { assignVisitAction } from "@/server/actions/assignments";
import { headsUpNotes } from "@/domain/memory";
import { requireShopSession } from "@/server/views/shop";
import {
  listVisitsRange,
  listAppointmentChoices,
  visitStatusLabel,
} from "@/domain/appointments";
import { getBusinessProfile } from "@/domain/business-profile";
import { calendarDate } from "@/domain/owner-money";
import { addLocalDays, localDateKey } from "@/lib/timezone";
import { isAutomotive } from "@/lib/business-types";
import { VisitEditor } from "@/components/visit-editor";
import { ActionForm } from "@/components/action-form";
import {
  rescheduleAppointmentAction,
  setAppointmentStatusAction,
} from "@/server/actions/appointments";
export default async function VisitsPage({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    customerId?: string;
    vehicleId?: string;
    serviceAssetId?: string;
    sourceRecoveryItemId?: string;
    sourceContactActivityId?: string;
    week?: string;
    booked?: string;
  }>;
}) {
  const p = await searchParams,
    s = await requireShopSession("/app/schedule");
  const creating = p.new === "1" || !!p.customerId || !!p.sourceRecoveryItemId;
  const data = await withTenant(s.businessId, s.actor, async (tx) => {
    const profile = await getBusinessProfile(tx),
      timezone = profile?.timezone ?? "America/Chicago",
      today = localDateKey(new Date(), timezone);
    const anchor = calendarDate.safeParse(p.week).success ? p.week! : today;
    const weekday = new Date(anchor + "T12:00:00Z").getUTCDay();
    const start = addLocalDays(anchor, -((weekday + 6) % 7));
    const visits = await listVisitsRange(tx, start, addLocalDays(start, 7));
    return {
      profile,
      today,
      start,
      anchor,
      options: creating ? await listAppointmentChoices(tx) : null,
      visits,
      techs: await listTechs(tx),
      headsUp: await headsUpNotes(tx, [
        ...new Set(visits.rows.map((r) => r.customerId)),
      ]),
    };
  });
  const dateLabel = (day: string) =>
    new Date(day + "T12:00:00Z").toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>{creating ? "New appointment" : "Appointments"}</h1>
      {p.booked === "1" && (
        <p className="notice ok" role="status">
          Appointment booked.
        </p>
      )}
      {creating ? (
        <>
          <Link href="/app/schedule">← Appointments</Link>
          <VisitEditor
            options={data.options!}
            auto={isAutomotive(data.profile?.businessType ?? "automotive")}
            initial={{
              customerId: p.customerId,
              vehicleId: p.vehicleId,
              serviceAssetId: p.serviceAssetId,
              day: data.anchor,
            }}
            source={{
              sourceRecoveryItemId: p.sourceRecoveryItemId,
              sourceContactActivityId: p.sourceContactActivityId,
            }}
          />
        </>
      ) : (
        <>
          <Link
            href={`/app/schedule?new=1&week=${data.anchor}`}
            className="btn primary"
            data-page-primary
          >
            + Appointment
          </Link>
          <div className="money-actions">
            <Link href={`/app/schedule?week=${addLocalDays(data.start, -7)}`}>
              Previous week
            </Link>
            <Link href="/app/schedule">This week</Link>
            <Link href={`/app/schedule?week=${addLocalDays(data.start, 7)}`}>
              Next week
            </Link>
          </div>
          <form method="get" className="card">
            <label htmlFor="visit-week">Go to a date</label>
            <input
              id="visit-week"
              name="week"
              type="date"
              defaultValue={data.anchor}
              required
            />
            <button className="btn secondary">Show week</button>
          </form>
          <p className="muted">
            {dateLabel(data.start)} – {dateLabel(addLocalDays(data.start, 6))} ·{" "}
            {data.visits.timezone}
          </p>
          {Array.from({ length: 7 }, (_, i) => addLocalDays(data.start, i)).map(
            (day) => (
              <section className="card" key={day}>
                <h2>
                  {day === data.today
                    ? "Today"
                    : day === addLocalDays(data.today, 1)
                      ? "Tomorrow"
                      : dateLabel(day)}
                </h2>
                {!data.visits.rows.some(
                  (a) => localDateKey(a.startsAt, data.visits.timezone) === day,
                ) && <p className="muted">No appointments.</p>}
                {data.visits.rows
                  .filter(
                    (a) =>
                      localDateKey(a.startsAt, data.visits.timezone) === day,
                  )
                  .map((a) => (
                    <article className="appointment-row" key={a.id}>
                      <strong>
                        {a.startsAt.toLocaleTimeString("en-US", {
                          timeZone: data.visits.timezone,
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </strong>
                      <div>
                        <Link href={`/app/customers/${a.customerId}`}>
                          {a.customerName}
                        </Link>
                        {data.headsUp
                          .filter((n) => n.customerId === a.customerId)
                          .slice(0, 1)
                          .map((n, i) => (
                            <p key={i} data-heads-up>
                              <span className="pill pill-warn">Heads-up</span>{" "}
                              {n.body}
                            </p>
                          ))}
                        <p>
                          {a.servicePlanId && (
                            <>
                              <span className="plan-badge">
                                ↻{" "}
                                {a.planRepeat
                                  ? everyLabel(
                                      a.planRepeat as unknown as Repeat,
                                    )
                                  : "Repeats"}
                              </span>{" "}
                            </>
                          )}
                          {a.reason || "Visit"} ·{" "}
                          {a.servicePlanId && a.status === "cancelled"
                            ? "Skipped"
                            : visitStatusLabel(a.status)}
                          {a.planInvoiceId ? " · Billed" : ""}
                          {a.assignedUserId &&
                            ` · ${data.techs.find((t) => t.userId === a.assignedUserId)?.name ?? "Team member"}`}
                        </p>
                        {a.serviceAssetName && (
                          <p>
                            {a.serviceAssetName} · {a.serviceAddress}
                          </p>
                        )}
                        {a.planJobId && (
                          <Link href={`/app/jobs?job=${a.planJobId}`}>
                            Open service plan
                          </Link>
                        )}
                        {!a.servicePlanId &&
                          (a.vehicleId || a.serviceAssetId) &&
                          a.status !== "cancelled" && (
                            <Link
                              href={`/app/jobs?${new URLSearchParams({ sourceAppointmentId: a.id, customerId: a.customerId, ...(a.vehicleId ? { vehicleId: a.vehicleId } : {}), ...(a.serviceAssetId ? { serviceAssetId: a.serviceAssetId } : {}) })}`}
                            >
                              Start job from visit
                            </Link>
                          )}
                      </div>
                      {a.status === "scheduled" &&
                        s.actor.type !== "support" && (
                          <div className="visit-actions">
                            <ActionForm
                              action={setAppointmentStatusAction}
                              hidden={{
                                appointmentId: a.id,
                                status: "completed",
                              }}
                              submitLabel={
                                a.servicePlanId && a.planBilling === "per_visit"
                                  ? "Mark done & create invoice"
                                  : "Mark visit done"
                              }
                              variant="primary"
                            />
                            {a.servicePlanId && (
                              <ActionForm
                                action={setAppointmentStatusAction}
                                hidden={{
                                  appointmentId: a.id,
                                  status: "cancelled",
                                }}
                                submitLabel="Skip this visit"
                                variant="secondary"
                              />
                            )}
                            {data.techs.length > 1 && (
                              <div
                                className="visit-tech"
                                key={a.assignedUserId ?? "none"}
                              >
                                <ActionForm
                                  action={assignVisitAction}
                                  hidden={{ appointmentId: a.id }}
                                  submitLabel="Save tech"
                                  variant="secondary"
                                >
                                  <label htmlFor={`tech-${a.id}`}>
                                    Who’s on this visit
                                  </label>
                                  <select
                                    id={`tech-${a.id}`}
                                    name="userId"
                                    defaultValue={a.assignedUserId ?? ""}
                                  >
                                    <option value="">Nobody yet</option>
                                    {data.techs.map((t) => (
                                      <option key={t.userId} value={t.userId}>
                                        {t.name}
                                      </option>
                                    ))}
                                  </select>
                                </ActionForm>
                              </div>
                            )}
                            <details>
                              <summary>Move, no-show or cancel</summary>
                              <ActionForm
                                action={setAppointmentStatusAction}
                                hidden={{
                                  appointmentId: a.id,
                                  status: "no_show",
                                }}
                                submitLabel="Customer didn’t show"
                                variant="secondary"
                              />
                              <ActionForm
                                action={rescheduleAppointmentAction}
                                hidden={{ appointmentId: a.id }}
                                submitLabel="Move visit"
                                variant="secondary"
                              >
                                <label htmlFor={`move-${a.id}`}>
                                  New date and time
                                </label>
                                <input
                                  id={`move-${a.id}`}
                                  name="startsAt"
                                  type="datetime-local"
                                  required
                                  defaultValue={a.startsAt
                                    .toLocaleString("sv-SE", {
                                      timeZone: data.visits.timezone,
                                    })
                                    .slice(0, 16)
                                    .replace(" ", "T")}
                                />
                              </ActionForm>
                              {!a.servicePlanId && (
                                <ActionForm
                                  action={setAppointmentStatusAction}
                                  hidden={{
                                    appointmentId: a.id,
                                    status: "cancelled",
                                  }}
                                  submitLabel="Cancel visit"
                                  variant="danger"
                                  confirm="Cancel this visit?"
                                />
                              )}
                            </details>
                          </div>
                        )}
                      {a.status !== "scheduled" &&
                        s.actor.type !== "support" && (
                          <ActionForm
                            action={setAppointmentStatusAction}
                            hidden={{
                              appointmentId: a.id,
                              status: "scheduled",
                            }}
                            submitLabel="Undo"
                            variant="secondary"
                          />
                        )}
                    </article>
                  ))}
              </section>
            ),
          )}
        </>
      )}
    </HydratedMain>
  );
}
