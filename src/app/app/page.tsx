import { HydratedMain } from "@/components/hydrated-main";
import { workspaceLabels } from "@/lib/business-types";
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
import { listTasks } from "@/domain/tasks";
import { loadPipeline } from "@/domain/pipeline";
import { isAutomotive } from "@/lib/business-types";

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
  const [profile, agenda, tasks, summary, recurring, pipe] = await withTenant(
    s.businessId,
    s.actor,
    async (tx) =>
      Promise.all([
        getBusinessProfile(tx),
        todayAgenda(tx),
        listTasks(tx),
        s.role === "owner"
          ? getOwnerMoney(tx, undefined, new Date(), false)
          : null,
        s.role === "owner" ? recurringRevenue(tx) : null,
        loadPipeline(tx),
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
  const light = open.length + tasks.due.length < 4;
  const auto = isAutomotive(type);
  const leads = tasks.due.filter((t) => t.category === "new_lead").length;
  const t = pipe.totals;
  const notScheduled = pipe.columns.approved.filter(
    (c) => c.status === "won",
  ).length;
  const notSent = pipe.columns.estimate.filter(
    (c) => c.status === "draft",
  ).length;
  const strip: {
    label: string;
    count: number;
    detail: string;
    href: string;
    warn?: boolean;
  }[] = [
    {
      label: "New leads",
      count: leads,
      detail: leads ? "to call today" : "all called",
      href: "/app/tasks",
    },
    {
      label: auto ? "Estimates" : "Bids",
      count: t.estimate.count,
      detail: notSent ? `${notSent} not sent` : formatMoney(t.estimate.cents),
      href: "/app/jobs?view=board",
      warn: notSent > 0,
    },
    {
      label: auto ? "Approved" : "Won",
      count: t.approved.count,
      detail: notScheduled
        ? `${notScheduled} not scheduled`
        : formatMoney(t.approved.cents),
      href: "/app/jobs?view=board",
      warn: notScheduled > 0,
    },
    {
      label: auto ? "In the shop" : "In progress",
      count: t.working.count,
      detail: formatMoney(t.working.cents),
      href: "/app/jobs?view=board",
    },
    {
      label: "Ready to invoice",
      count: t.invoice.count,
      detail: formatMoney(t.invoice.cents),
      href: "/app/jobs?view=board",
      warn: t.invoice.count > 0,
    },
    {
      label: "Unpaid",
      count: t.unpaid.count,
      detail: formatMoney(t.unpaid.cents),
      href: "/app/jobs?view=board",
      warn: t.unpaid.count > 0,
    },
  ];
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      {params.denied && (
        <p role="status" className="notice error">
          Only the owner can open that page.
        </p>
      )}
      <div className="page-heading">
        <h1>Today</h1>
        <p className="muted">{date}</p>
      </div>
      <Link className="btn primary" data-page-primary href="/app/jobs?new=1">
        {labels.newJob}
      </Link>
      {s.role === "owner" &&
        (!profile?.businessTypeSelected ||
          !profile?.phoneE164 ||
          !profile.addressLine1) && (
          <p className="setup-line">
            <Link href="/app/settings/business">
              Finish setting up your business →
            </Link>
          </p>
        )}
      <div className="pipeline-strip" aria-label="Where your jobs are">
        {strip.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className={`pipeline-cell${c.warn ? " warn" : ""}`}
          >
            <span>{c.label}</span>
            <strong>{c.count}</strong>
            <span>{c.detail}</span>
          </Link>
        ))}
      </div>
      {summary && (
        <p className="money-line">
          <Link href="/app/money">
            Collected this month{" "}
            <strong>{formatMoney(summary.collectedCents)}</strong>
          </Link>
          {recurring && recurring.plans > 0 && (
            <Link href="/app/jobs?show=recurring">
              Recurring{" "}
              <strong>{formatMoney(recurring.monthlyCents)}/mo</strong>
            </Link>
          )}
        </p>
      )}
      <div className="home-columns">
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
        <section className="card" aria-label="Tasks due">
          <div className="section-heading">
            <h2>
              Tasks due
              {tasks.due.length ? (
                <span className="count-warn"> {tasks.due.length}</span>
              ) : null}
            </h2>
            <Link href="/app/tasks">All tasks</Link>
          </div>
          {!tasks.due.length && <p>You’re all caught up.</p>}
          <ul className="row-list">
            {tasks.due.slice(0, 6).map((task) => (
              <li key={task.key}>
                <Link href={task.action?.href ?? task.href ?? "/app/tasks"}>
                  <span className="row-main">
                    <strong>{task.title}</strong>
                    <span className="muted">
                      {task.action?.label ?? task.detail ?? task.kindLabel}
                    </span>
                  </span>
                  {task.amountCents !== null && task.amountCents > 0 && (
                    <span className="row-side">
                      {formatMoney(task.amountCents)}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          {tasks.due.length > 6 && (
            <Link href="/app/tasks">{tasks.due.length - 6} more in Tasks</Link>
          )}
        </section>
      </div>
      {light && <RecentCustomers />}
    </HydratedMain>
  );
}
