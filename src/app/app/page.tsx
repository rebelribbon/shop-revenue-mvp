import { HydratedMain } from "@/components/hydrated-main";
import {
  isAutomotive,
  workspaceLabels,
  businessTypeLabel,
} from "@/lib/business-types";
import Link from "next/link";
import { getOwnerMoney } from "@/domain/owner-money";
import { formatMoney } from "@/components/estimate-document";
import { redirect } from "next/navigation";
import { withTenant } from "@/db/tenant";
import { recurringRevenue } from "@/domain/service-plans";
import { requireShopSession } from "@/server/views/shop";
import { getBusinessProfile } from "@/domain/business-profile";
import { listTodayTomorrow } from "@/domain/appointments";
import { listEstimates } from "@/domain/estimates";
import { listInvoices } from "@/domain/invoices";
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
  const [profile, days, estimates, invoices, money, summary, recurring] =
    await withTenant(s.businessId, s.actor, (tx) =>
      Promise.all([
        getBusinessProfile(tx),
        listTodayTomorrow(tx),
        listEstimates(tx),
        listInvoices(tx),
        getMoneyFinder(tx, { view: "active", page: 1, query: "" }),
        s.role === "owner"
          ? getOwnerMoney(tx, undefined, new Date(), false)
          : null,
        s.role === "owner" ? recurringRevenue(tx) : null,
      ]),
    );
  const type = profile?.businessType ?? "automotive",
    auto = isAutomotive(type),
    labels = workspaceLabels(type);
  const latest = estimates.filter(
    (e, i, a) => a.findIndex((x) => x.quoteId === e.quoteId) === i,
  );
  const waiting = latest.filter(
    (e) => !e.authorization && !e.revokedAt && e.expiresAt > new Date(),
  );
  const unpaid = invoices.filter((i) => !i.voidedAt && i.balanceCents > 0);
  const visits = days.today.filter((a) => a.status === "scheduled");
  const date = new Date().toLocaleDateString("en-US", {
    timeZone: days.timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      {params.denied && (
        <p role="status" className="notice error">
          Only the owner can open that page.
        </p>
      )}
      <div className="page-heading">
        <h1>Home</h1>
        <p className="muted">
          {businessTypeLabel(type)} · {date}
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
        </div>
      )}
      {recurring && recurring.plans > 0 && (
        <div className="overview-metrics">
          <Link href="/app/jobs?stage=plan" className="card overview-metric">
            <strong>{formatMoney(recurring.monthlyCents)}/mo</strong>
            <span>
              Recurring from {recurring.plans} service plan
              {recurring.plans === 1 ? "" : "s"}
            </span>
          </Link>
        </div>
      )}
      <div className="overview-metrics">
        <Link className="card overview-metric" href="/app/schedule">
          <strong>{visits.length}</strong>
          <span>Scheduled today</span>
        </Link>
        <Link className="card overview-metric" href="/app/opportunities">
          <strong>{money.total}</strong>
          <span>Follow-ups</span>
        </Link>
      </div>
      <div className="overview-columns">
        <section className="card">
          <div className="section-heading">
            <h2>Today’s visits</h2>
            <Link href="/app/schedule">Full schedule</Link>
          </div>
          {!visits.length && (
            <p className="muted">
              Nothing scheduled for today. Add a visit or start a job when a
              customer arrives.
            </p>
          )}
          {visits.slice(0, 5).map((a) => (
            <div className="overview-row" key={a.id}>
              <strong>
                {a.startsAt.toLocaleTimeString("en-US", {
                  timeZone: days.timezone,
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </strong>
              <div>
                <Link href={`/app/customers/${a.customerId}`}>
                  {a.customerName}
                </Link>
                <p>{a.reason || "Visit"}</p>
                {a.serviceAssetName && (
                  <p className="muted">
                    {a.serviceAssetName} · {a.serviceAddress}
                  </p>
                )}
              </div>
            </div>
          ))}
          <Link className="btn secondary" href="/app/schedule?new=1">
            Book visit
          </Link>
        </section>
        <section className="card">
          <h2>Next steps on recent work</h2>
          <p className="muted">Pick up where you left off.</p>
          <div className="overview-row">
            <div>
              <strong>{waiting.length} awaiting customer approval</strong>
              <p>Review estimates and their latest decisions.</p>
            </div>
            <Link href="/app/estimates">See estimates</Link>
          </div>
          <div className="overview-row">
            <div>
              <strong>
                {summary ? formatMoney(summary.owedCents) : unpaid.length}{" "}
                {summary ? "owed by customers" : "invoices waiting for payment"}
              </strong>
              <p>Review payments and outstanding amounts.</p>
            </div>
            <Link href="/app/invoices">See invoices</Link>
          </div>
          <div className="overview-row">
            <div>
              <strong>
                {auto ? "Jobs and labor costs" : "Jobs and labor costs"}
              </strong>
              <p>
                Track customer approval, authorized work, completion, invoices
                and payment in one job timeline.
              </p>
            </div>
            <Link href="/app/jobs">See all {labels.jobs.toLowerCase()}</Link>
          </div>
        </section>
      </div>
      <section className="card">
        <h2>Start with a customer</h2>
        <p>
          {auto
            ? "Find contact details, vehicles, repair history and notes in one place."
            : "Find contact details, properties, equipment, work history and notes in one place."}
        </p>
        <div className="money-actions">
          <Link href="/app/customers">Find a customer</Link>
          <Link href="/app/customers/new">Add a customer</Link>
        </div>
      </section>
    </HydratedMain>
  );
}
