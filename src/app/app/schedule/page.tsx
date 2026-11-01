import { HydratedMain } from "@/components/hydrated-main";
import Link from "next/link";
import { withTenant } from "@/db/tenant";
import { requireShopSession } from "@/server/views/shop";
import { listVisitsRange, listAppointmentChoices } from "@/domain/appointments";
import { getBusinessProfile } from "@/domain/business-profile";
import { calendarDate } from "@/domain/owner-money";
import { addLocalDays, localDateKey } from "@/lib/timezone";
import { isAutomotive } from "@/lib/business-types";
import { VisitEditor } from "@/components/visit-editor";
import { ActionForm } from "@/components/action-form";
import { setAppointmentStatusAction } from "@/server/actions/appointments";
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
    return {
      profile,
      today,
      start,
      anchor,
      options: creating ? await listAppointmentChoices(tx) : null,
      visits: await listVisitsRange(tx, start, addLocalDays(start, 7)),
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
      <h1>{creating ? "Book a visit" : "Visits"}</h1>
      {p.booked === "1" && (
        <p className="notice ok" role="status">
          Visit booked.
        </p>
      )}
      {creating ? (
        <>
          <Link href="/app/schedule">← All visits</Link>
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
            Book visit
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
                ) && <p className="muted">No visits.</p>}
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
                        <p>
                          {a.reason || "Visit"} ·{" "}
                          {a.status === "scheduled"
                            ? "Booked"
                            : a.status.replace("_", " ")}
                        </p>
                        {a.serviceAssetName && (
                          <p>
                            {a.serviceAssetName} · {a.serviceAddress}
                          </p>
                        )}
                        {(a.vehicleId || a.serviceAssetId) &&
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
                          <details>
                            <summary>Update visit</summary>
                            <ActionForm
                              action={setAppointmentStatusAction}
                              hidden={{
                                appointmentId: a.id,
                                status: "completed",
                              }}
                              submitLabel="Mark visit complete"
                              variant="secondary"
                            />
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
                          </details>
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
