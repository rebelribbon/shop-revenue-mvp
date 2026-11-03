import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { formatMoney } from "@/components/estimate-document";
import { HydratedMain } from "@/components/hydrated-main";
import { MoneyNavigation } from "@/components/money-navigation";
import { withTenant } from "@/db/tenant";
import { getBusinessProfile } from "@/domain/business-profile";
import {
  RANGES,
  SOURCES,
  buildReport,
  configQuery,
  listSavedReports,
  readConfig,
} from "@/domain/report-builder";
import { REPORTS, presetRange } from "@/domain/reports";
import { localDateKey } from "@/lib/timezone";
import {
  saveReportAction,
  updateSavedReportAction,
} from "@/server/actions/reports";
import { requireOwnerView } from "@/server/views/shop";

export default async function BuildReportPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await props.searchParams;
  const s = await requireOwnerView("/app/money/reports/build");
  const { config, report, saved, current } = await withTenant(
    s.businessId,
    s.actor,
    async (tx) => {
      const saved = await listSavedReports(tx);
      const current =
        typeof p.saved === "string"
          ? saved.find((r) => r.id === p.saved)
          : undefined;
      const config = current?.config ?? readConfig(p);
      const profile = await getBusinessProfile(tx);
      const today = localDateKey(
        new Date(),
        profile?.timezone || "America/Chicago",
      );
      const report = await buildReport(
        tx,
        config,
        presetRange(config.range, today),
      );
      return { config, report, saved, current };
    },
  );
  const src = SOURCES[config.source];
  const max = Math.max(1, ...report.bars.map((b) => Math.abs(b.value)));
  const show = (
    v: string | number | null,
    col: { money?: boolean } | undefined,
  ) =>
    v === null ? "—" : col?.money && typeof v === "number" ? formatMoney(v) : v;
  const barText = (b: (typeof report.bars)[number]) =>
    b.money
      ? formatMoney(b.value)
      : b.percent
        ? `${b.value}%`
        : String(b.value);
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Reports</h1>
      <MoneyNavigation current="reports" />
      <a
        className="btn primary"
        data-page-primary
        href={`/app/money/reports/csv?custom=1&${configQuery(config)}`}
      >
        Download this report (CSV)
      </a>
      <div className="report-layout">
        <section className="card report-list" aria-label="Reports">
          <h2>Your reports</h2>
          {saved.length === 0 && (
            <p className="muted">Build one, then save it here.</p>
          )}
          {saved.map((r) => (
            <Link
              key={r.id}
              href={`/app/money/reports/build?saved=${r.id}`}
              aria-current={current?.id === r.id ? "page" : undefined}
            >
              {r.pinned ? "★ " : ""}
              {r.name}
            </Link>
          ))}
          <h2>Ready-made</h2>
          {REPORTS.map((r) => (
            <Link key={r.key} href={`/app/money/reports?report=${r.key}`}>
              {r.title}
            </Link>
          ))}
        </section>

        <div className="report-main">
          <section className="card" aria-label="Build a report">
            <h2>{current ? current.name : "Build a report"}</h2>
            <form method="get" className="report-form">
              <label htmlFor="rb-source">What to look at</label>
              <select id="rb-source" name="source" defaultValue={config.source}>
                {Object.entries(SOURCES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
              <label htmlFor="rb-group">Group by</label>
              <select id="rb-group" name="group" defaultValue={config.group}>
                {Object.entries(src.dims).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
              <fieldset className="chips">
                <legend>Show</legend>
                {Object.entries(src.measures).map(([k, v]) => (
                  <label key={k}>
                    <input
                      type="checkbox"
                      name="measures"
                      value={k}
                      defaultChecked={config.measures.includes(k)}
                    />
                    {v.label}
                  </label>
                ))}
              </fieldset>
              <label htmlFor="rb-range">When</label>
              <select id="rb-range" name="range" defaultValue={config.range}>
                {RANGES.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <fieldset className="chips">
                <legend>View</legend>
                <label>
                  <input
                    type="radio"
                    name="view"
                    value="bars"
                    defaultChecked={config.view === "bars"}
                  />
                  Bars
                </label>
                <label>
                  <input
                    type="radio"
                    name="view"
                    value="table"
                    defaultChecked={config.view === "table"}
                  />
                  Table only
                </label>
              </fieldset>
              <button className="btn secondary">Show report</button>
            </form>
          </section>

          <section className="card" aria-label="Report">
            <h2>{report.title}</h2>
            <p className="report-headline">{report.headline}</p>
            {report.rows.length === 0 ? (
              <p className="muted">Nothing in these dates yet.</p>
            ) : (
              <>
                {config.view === "bars" && (
                  <figure
                    className="report-bars"
                    aria-label={`Bar chart: ${report.bars
                      .slice(0, 12)
                      .map((b) => `${b.label} ${barText(b)}`)
                      .join(", ")}`}
                  >
                    {report.bars.slice(0, 12).map((b) => (
                      <div className="report-bar" key={b.label}>
                        <span>{b.label}</span>
                        <span className="report-bar-track" aria-hidden="true">
                          <span
                            style={{
                              width: `${Math.max(2, (Math.abs(b.value) / max) * 100)}%`,
                            }}
                          />
                        </span>
                        <strong>{barText(b)}</strong>
                      </div>
                    ))}
                  </figure>
                )}
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
                            <td key={j}>{show(v, report.columns[j])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    {report.totals && (
                      <tfoot>
                        <tr>
                          {report.totals.map((v, j) => (
                            <th key={j}>{show(v, report.columns[j])}</th>
                          ))}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </>
            )}
          </section>

          {s.actor.type !== "support" && (
            <section className="card" aria-label="Save this report">
              {current ? (
                <>
                  <h2>Saved as “{current.name}”</h2>
                  <div className="action-bar">
                    <ActionForm
                      action={updateSavedReportAction}
                      hidden={{
                        id: current.id,
                        action: current.pinned ? "unpin" : "pin",
                      }}
                      submitLabel={
                        current.pinned ? "Unpin from Home" : "Pin to Home"
                      }
                      variant="secondary"
                    />
                    <ActionForm
                      action={updateSavedReportAction}
                      hidden={{ id: current.id, action: "remove" }}
                      submitLabel="Remove report"
                      variant="danger"
                      confirm="Remove this saved report? The numbers aren’t affected."
                    />
                  </div>
                </>
              ) : (
                <>
                  <h2>Save this report</h2>
                  <ActionForm
                    action={saveReportAction}
                    hidden={{
                      source: config.source,
                      group: config.group,
                      measures: config.measures.join(","),
                      range: config.range,
                      view: config.view,
                    }}
                    submitLabel="Save report"
                    variant="secondary"
                  >
                    <label htmlFor="rb-name">Name</label>
                    <input
                      id="rb-name"
                      name="name"
                      required
                      maxLength={120}
                      defaultValue={report.title}
                    />
                    <label>
                      <input type="checkbox" name="pinned" />
                      Pin to Home
                    </label>
                  </ActionForm>
                </>
              )}
            </section>
          )}
        </div>
      </div>
    </HydratedMain>
  );
}
