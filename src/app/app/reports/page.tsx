import { HydratedMain } from "@/components/hydrated-main";
import Link from "next/link";
import { formatMoney } from "@/components/estimate-document";
import { withTenant } from "@/db/tenant";
import { getBusinessProfile } from "@/domain/business-profile";
import {
  REPORTS,
  presetRange,
  runReport,
  type ReportKey,
} from "@/domain/reports";
import { localDateKey } from "@/lib/timezone";
import { requireShopSession } from "@/server/views/shop";
import { listSavedReports } from "@/domain/report-builder";

const PRESETS = [
  ["month", "This month"],
  ["last-month", "Last month"],
  ["quarter", "This quarter"],
  ["last-quarter", "Last quarter"],
  ["year", "This year"],
  ["last-year", "Last year"],
] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const nice = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    report?: string;
    range?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const s = await requireShopSession("/app/reports");
  if (s.role === "staff" || s.role === "technician") {
    return (
      <HydratedMain id="main-content" tabIndex={-1}>
        <h1>Reports</h1>
        <section className="card"><h2>Owner access required</h2><p>Business-wide financial and performance reports are available to owners. Your appointments, tasks, customers, and assigned jobs remain accessible from the main tabs.</p></section>
      </HydratedMain>
    );
  }
  const p = await searchParams;
  const key = (REPORTS.find((r) => r.key === p.report)?.key ??
    "sales") as ReportKey;
  const { report, range, preset, saved } = await withTenant(
    s.businessId,
    s.actor,
    async (tx) => {
      const profile = await getBusinessProfile(tx);
      const today = localDateKey(
        new Date(),
        profile?.timezone || "America/Chicago",
      );
      const custom =
        p.from && p.to && DAY.test(p.from) && DAY.test(p.to) && p.from <= p.to;
      const preset = custom ? "custom" : (p.range ?? "month");
      const range = custom
        ? { from: p.from!, to: p.to! }
        : presetRange(preset, today);
      return {
        report: await runReport(tx, key, range),
        range,
        preset,
        saved: await listSavedReports(tx),
      };
    },
  );
  const info = REPORTS.find((r) => r.key === key)!;
  const qs = (extra: Record<string, string>) =>
    new URLSearchParams({
      report: key,
      ...(preset === "custom"
        ? { from: range.from, to: range.to }
        : { range: preset }),
      ...extra,
    }).toString();
  const show = (v: string | number | null, money?: boolean) =>
    v === null ? "" : money && typeof v === "number" ? formatMoney(v) : v;
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Reports</h1>
      <a
        className="btn primary"
        data-page-primary
        href={`/app/money/reports/csv?${qs({})}`}
      >
        Download {info.title} (CSV)
      </a>
      <p className="report-build-link">
        <Link href="/app/reports/build">
          Build your own report: group by month, customer, tech or job, and save
          it
        </Link>
      </p>
      {saved.length > 0 && (
        <div className="chip-links" role="group" aria-label="Your reports">
          {saved.map((r) => (
            <Link key={r.id} href={`/app/reports/build?saved=${r.id}`}>
              {r.pinned ? "★ " : ""}
              {r.name}
            </Link>
          ))}
        </div>
      )}
      <div className="chip-links" role="group" aria-label="Report">
        {REPORTS.map((r) => (
          <Link
            key={r.key}
            href={`/app/reports?${new URLSearchParams({
              report: r.key,
              ...(preset === "custom"
                ? { from: range.from, to: range.to }
                : { range: preset }),
            })}`}
            aria-current={r.key === key ? "true" : undefined}
          >
            {r.title}
          </Link>
        ))}
      </div>
      <div className="chip-links" role="group" aria-label="Dates">
        {PRESETS.map(([value, label]) => (
          <Link
            key={value}
            href={`/app/reports?${new URLSearchParams({ report: key, range: value })}`}
            aria-current={preset === value ? "true" : undefined}
          >
            {label}
          </Link>
        ))}
      </div>
      <form method="get" className="card">
        <input type="hidden" name="report" value={key} />
        <label htmlFor="report-from">From</label>
        <input
          id="report-from"
          name="from"
          type="date"
          defaultValue={range.from}
          required
        />
        <label htmlFor="report-to">To</label>
        <input
          id="report-to"
          name="to"
          type="date"
          defaultValue={range.to}
          required
        />
        <button className="btn secondary">Show these dates</button>
      </form>
      <section className="card">
        <h2>
          {info.title}: {nice(range.from)} – {nice(range.to)}
        </h2>
        <p className="muted">{info.about}</p>
        {!report.rows.length ? (
          <p>Nothing in these dates.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {report.columns.map((c) => (
                    <th key={c.label}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.slice(0, 200).map((row, i) => (
                  <tr key={i}>
                    {row.map((v, j) => (
                      <td key={j}>{show(v, report.columns[j]?.money)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {report.totals && (
                <tfoot>
                  <tr>
                    {report.totals.map((v, j) => (
                      <th key={j}>{show(v, report.columns[j]?.money)}</th>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        {report.rows.length > 200 && (
          <p className="muted">
            Showing the first 200 rows. The download has all{" "}
            {report.rows.length}.
          </p>
        )}
      </section>
    </HydratedMain>
  );
}
