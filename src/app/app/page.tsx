import { HydratedMain } from "@/components/hydrated-main";
import { workspaceLabels, businessTypeLabel } from "@/lib/business-types";
import { todayAgenda } from "@/domain/today";
import { RecentCustomers } from "@/components/recent-customers";
import { ActionForm } from "@/components/action-form";
import { setAppointmentStatusAction } from "@/server/actions/appointments";
import Link from "next/link";
import { getOwnerMoney } from "@/domain/owner-money";
import { formatMoney } from "@/components/estimate-document";
import { redirect } from "next/navigation";
import { withTenant } from "@/db/tenant";
import { recurringRevenue } from "@/domain/service-plans";
import { requireShopSession } from "@/server/views/shop";
import { getBusinessProfile } from "@/domain/business-profile";
import { getMoneyFinder } from "@/domain/money-finder";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{
    denied?: string;
    category?: string;
    view?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  // Existing bookmarked Follow-ups filters keep their meaning.
  if (params.category || params.view || params.q || params.page) {
    const query = new URLSearchParams(
      Object.entries(params).filter(
        ([key, value]) => key !== "denied" && typeof value === "string",
      ) as [string, string][],
    );
    redirect(`/app/opportunities?${query}`);
  }
  const s = await requireShopSession("/app");
  const [profile, agenda, money, summary, recurring] = await withTenant(
    s.businessId,
    s.actor,
    async (tx) =>
      Promise.all([
        getBusinessProfile(tx),
        todayAgenda(tx),
        getMoneyFinder(tx, { view: "active", page: 1, query: "" }),
        s.role === "owner"
          ? getOwnerMoney(tx, undefined, new Date(), false)
          : null,
        s.role === "owner" ? recurringRevenue(tx) : null,
      ]),
  );
  const type = profile?.businessType ?? "automotive",
    labels = workspaceLabels(type);
  const tz = agenda.visits.timezone;
  const today = agenda.visits.today;
  const open = today.filter((a) => a.status === "scheduled");
  const date = new Date().toLocaleDateString("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const time = (d: Date) =>
    d.toLocaleTimeString("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
    });
  const light = open.length + agenda.items.length < 4;
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      {params.denied && (
        <p role="status" className="notice error">
          Only the owner can open that page.
        </p>
      )}
      <div className="page-heading">
        <h1>Today</h1>
        <p className="muted">
          {date} · {businessTypeLabel(type)}
        </p>
      </div>
      <Link className="btn primary" data-page-primary href="/app/jobs?new=1">
        {labels.newJob}
      </Link>
      {(!profile?.phoneE164 || !profile.addressLine1) && (
        <div className="notice banner">
          <p>
            Finish your business details so appointments and documents use the
            right information.
          </p>
          <Link href="/app/settings/business">Finish setup</Link>
        </div>
      )}
      {summary && (
        <div className="overview-metrics">
          <Link href="/app/money" className="card overview-metric">
            <strong>{formatMoney(summary.collectedCents)}</strong>
            <span>Collected this month</span>
          </Link>
          <Link href="/app/money" className="card overview-metric">
            <strong>{formatMoney(summary.owedCents)}</strong>
            <span>Customers owe you</span>
          </Link>
          {recurring && recurring.plans > 0 && (
            <Link
              href="/app/jobs?show=recurring"
              className="card overview-metric"
            >
              <strong>{formatMoney(recurring.monthlyCents)}/mo</strong>
              <span>
                Recurring from {recurring.plans} service plan
                {recurring.plans === 1 ? "" : "s"}
              </span>
            </Link>
          )}
        </div>
      )}
      <section className="card" aria-label="Today’s visits">
        <div className="section-heading">
          <h2>Visits today{open.length ? ` (${open.length})` : ""}</h2>
          <Link href="/app/schedule">Week calendar</Link>
        </div>
        {!today.length && <p className="muted">Nothing booked today.</p>}
        {today.map((a) => (
          <div className="overview-row" key={a.id}>
            <Link
              href={
                a.planJobId
                  ? `/app/jobs?job=${a.planJobId}`
                  : `/app/customers/${a.customerId}`
              }
            >
              <strong>{time(a.startsAt)}</strong>{" "}
              {a.servicePlanId && <span className="plan-badge">↻</span>}{" "}
              {a.customerName} · {a.reason || "Visit"}
              {a.serviceAssetName && (
                <span className="muted">
                  {" "}
                  · {a.serviceAddress || a.serviceAssetName}
                </span>
              )}
            </Link>
            {a.status === "scheduled" && s.actor.type !== "support" ? (
              <span className="visit-actions">
                <ActionForm
                  action={setAppointmentStatusAction}
                  hidden={{ appointmentId: a.id, status: "completed" }}
                  submitLabel={
                    a.servicePlanId && a.planBilling === "per_visit"
                      ? "Done & bill"
                      : "Done"
                  }
                  variant="secondary"
                />
                {a.servicePlanId && (
                  <ActionForm
                    action={setAppointmentStatusAction}
                    hidden={{ appointmentId: a.id, status: "cancelled" }}
                    submitLabel="Skip"
                    variant="secondary"
                  />
                )}
              </span>
            ) : (
              <span
                className={a.status === "completed" ? "pill pill-ok" : "pill"}
              >
                {a.status === "completed"
                  ? "Done"
                  : a.status === "cancelled"
                    ? "Skipped"
                    : a.status === "no_show"
                      ? "No-show"
                      : "To do"}
              </span>
            )}
          </div>
        ))}
        {agenda.visits.tomorrow.length > 0 && (
          <p className="muted">
            Tomorrow: {agenda.visits.tomorrow.length} visit
            {agenda.visits.tomorrow.length === 1 ? "" : "s"}, first at{" "}
            {time(agenda.visits.tomorrow[0].startsAt)}.
          </p>
        )}
        <Link className="btn secondary" href="/app/schedule?new=1">
          Book a visit
        </Link>
      </section>
      <section className="card" aria-label="Needs you today">
        <h2>
          Needs you{agenda.items.length ? ` (${agenda.items.length})` : ""}
        </h2>
        {!agenda.items.length && <p>You’re all caught up. 🎉</p>}
        {agenda.items.slice(0, 15).map((i) => (
          <Link className="overview-row today-item" key={i.id} href={i.href}>
            <span>
              <strong>{i.title}</strong>
              <span className="muted"> · {i.detail}</span>
            </span>
            <span>
              {i.amountCents !== null && (
                <strong>{formatMoney(i.amountCents)} </strong>
              )}
              <span className={i.urgent ? "pill pill-warn" : "pill"}>
                {i.action}
              </span>
            </span>
          </Link>
        ))}
        {money.total > 0 && (
          <Link className="overview-row" href="/app/opportunities">
            <span>
              <strong>
                {money.total} follow-up{money.total === 1 ? "" : "s"}
              </strong>
              <span className="muted">
                {" "}
                · declined work, service due and customers to check on
              </span>
            </span>
            <span className="pill">Open follow-ups</span>
          </Link>
        )}
      </section>
      {light && <RecentCustomers />}
      <section className="card">
        <h2>Find a customer</h2>
        <div className="money-actions">
          <Link href="/app/customers">Customer list</Link>
          <Link href="/app/customers/new">Add a customer</Link>
        </div>
      </section>
    </HydratedMain>
  );
}
