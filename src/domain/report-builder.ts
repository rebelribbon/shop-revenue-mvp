// Build-your-own reports: pick what to look at, how to group it and what to
// show. Built on the same numbers as the ready-made reports, so a custom
// report can never disagree with them.
import { z } from "zod";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { savedReport } from "@/db/schema";
import { notFound } from "@/lib/errors";
import { audit, type RequestMeta } from "./records";
import { METHOD_LABELS } from "./register";
import type { TenantTx } from "@/db/tenant";
import { localDateKey } from "@/lib/timezone";
import { assertOwner } from "./membership";
import { runReport, type Range, type Report, type ReportKey } from "./reports";

type Dim = { label: string; col: number; date?: boolean };
type Measure = {
  label: string;
  money?: boolean;
  percent?: boolean;
  // Sum of a column, a row count, or a ratio of two sums.
  sum?: number;
  count?: true;
  ratio?: [number, number];
  avgOf?: number;
};
type Source = {
  label: string;
  base: ReportKey | "hours";
  dims: Record<string, Dim>;
  measures: Record<string, Measure>;
};

const DATE_DIMS = (col: number): Record<string, Dim> => ({
  month: { label: "Month", col, date: true },
  week: { label: "Week", col, date: true },
  day: { label: "Day", col, date: true },
});

export const SOURCES: Record<string, Source> = {
  sales: {
    label: "Sales (invoices)",
    base: "sales",
    dims: {
      ...DATE_DIMS(0),
      customer: { label: "Customer", col: 2 },
      job: { label: "Job", col: 3 },
      source: { label: "Lead source", col: 9 },
    },
    measures: {
      count: { label: "Invoices", count: true },
      sales: { label: "Sales before tax", money: true, sum: 4 },
      tax: { label: "Sales tax", money: true, sum: 5 },
      total: { label: "Total billed", money: true, sum: 6 },
      owed: { label: "Still owed", money: true, sum: 8 },
      avg: { label: "Average ticket", money: true, avgOf: 6 },
    },
  },
  profit: {
    label: "Profit (invoiced jobs)",
    base: "profit",
    dims: {
      ...DATE_DIMS(0),
      customer: { label: "Customer", col: 2 },
      job: { label: "Job", col: 3 },
      source: { label: "Lead source", col: 8 },
    },
    measures: {
      count: { label: "Jobs", count: true },
      sales: { label: "Billed before tax", money: true, sum: 4 },
      cost: { label: "Cost", money: true, sum: 5 },
      profit: { label: "Profit", money: true, sum: 6 },
      margin: { label: "Margin", percent: true, ratio: [6, 4] },
      avg: { label: "Average profit", money: true, avgOf: 6 },
    },
  },
  payments: {
    label: "Payments received",
    base: "payments",
    dims: {
      ...DATE_DIMS(0),
      customer: { label: "Customer", col: 2 },
      method: { label: "How they paid", col: 3 },
      source: { label: "Lead source", col: 6 },
    },
    measures: {
      count: { label: "Payments", count: true },
      amount: { label: "Amount", money: true, sum: 5 },
      avg: { label: "Average payment", money: true, avgOf: 5 },
    },
  },
  expenses: {
    label: "Expenses",
    base: "expenses",
    dims: {
      ...DATE_DIMS(0),
      category: { label: "Category", col: 1 },
    },
    measures: {
      count: { label: "Expenses", count: true },
      amount: { label: "Amount", money: true, sum: 3 },
    },
  },
  hours: {
    label: "Hours clocked",
    base: "hours",
    dims: {
      ...DATE_DIMS(0),
      tech: { label: "Tech", col: 1 },
      job: { label: "Job", col: 2 },
    },
    measures: {
      count: { label: "Clock-ins", count: true },
      hours: { label: "Hours", sum: 3 },
    },
  },
};

export const RANGES = [
  ["month", "This month"],
  ["last-month", "Last month"],
  ["quarter", "This quarter"],
  ["last-quarter", "Last quarter"],
  ["year", "This year"],
  ["last-year", "Last year"],
] as const;

export const builderConfig = z
  .object({
    source: z.enum(Object.keys(SOURCES) as [string, ...string[]]),
    group: z.string(),
    measures: z.array(z.string()).min(1).max(6),
    range: z.enum(RANGES.map((r) => r[0]) as [string, ...string[]]),
    view: z.enum(["bars", "table"]),
  })
  .refine((c) => !!SOURCES[c.source].dims[c.group], {
    message: "Pick how to group this report.",
    path: ["group"],
  })
  .refine((c) => c.measures.every((m) => !!SOURCES[c.source].measures[m]), {
    message: "Pick what to show.",
    path: ["measures"],
  });
export type BuilderConfig = z.infer<typeof builderConfig>;

export const DEFAULT_CONFIG: BuilderConfig = {
  source: "profit",
  group: "month",
  measures: ["sales", "profit", "margin"],
  range: "year",
  view: "bars",
};

// Read a config from loose input (URL params, a saved report), falling back
// to sensible choices instead of failing.
export function readConfig(
  raw: Partial<Record<string, unknown>>,
): BuilderConfig {
  const source =
    typeof raw.source === "string" && SOURCES[raw.source]
      ? raw.source
      : DEFAULT_CONFIG.source;
  const src = SOURCES[source];
  const group =
    typeof raw.group === "string" && src.dims[raw.group] ? raw.group : "month";
  const list = (
    Array.isArray(raw.measures)
      ? raw.measures
      : typeof raw.measures === "string"
        ? raw.measures.split(",")
        : []
  ).filter((m): m is string => typeof m === "string" && !!src.measures[m]);
  const measures = list.length
    ? [...new Set(list)].slice(0, 6)
    : Object.keys(src.measures).slice(0, 2);
  const range = RANGES.some((r) => r[0] === raw.range)
    ? String(raw.range)
    : DEFAULT_CONFIG.range;
  const view = raw.view === "table" ? "table" : "bars";
  return { source, group, measures, range, view };
}

// Monday-start week label, e.g. "Week of Nov 2".
function weekOf(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
const nice = (day: string, kind: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  if (kind === "month")
    return d.toLocaleDateString("en-US", {
      timeZone: "UTC",
      month: "short",
      year: "numeric",
    });
  const s = d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
  return kind === "week" ? `Week of ${s}` : s;
};

async function hoursRows(tx: TenantTx, range: Range): Promise<Report["rows"]> {
  const tz = String(
    (
      await tx.execute(
        sql`SELECT timezone FROM app.business WHERE id=${tx.businessId}`,
      )
    ).rows[0]?.timezone || "America/Chicago",
  );
  const rows = await tx.execute(sql`
    SELECT t.started_at, u.display_name AS tech,
      coalesce((SELECT a.summary FROM app.activity a WHERE a.business_id=t.business_id
        AND a.kind='job.costed' AND a.subject_id=t.job_id ORDER BY a.occurred_at DESC LIMIT 1),'Job') AS job,
      extract(epoch FROM (coalesce(t.ended_at, now()) - t.started_at)) / 3600.0 AS hours
    FROM app.time_entry t JOIN app."user" u ON u.id=t.user_id
    WHERE t.business_id=${tx.businessId}
      AND (t.started_at AT TIME ZONE ${tz})::date BETWEEN ${range.from}::date AND ${range.to}::date
    ORDER BY t.started_at`);
  return rows.rows.map((r) => [
    localDateKey(new Date(String(r.started_at)), tz),
    String(r.tech),
    String(r.job),
    Math.round(Number(r.hours) * 100) / 100,
  ]);
}

export type BuiltReport = Report & {
  title: string;
  // The first measure per group, for the bar chart.
  bars: { label: string; value: number; money: boolean; percent: boolean }[];
  headline: string;
};

export async function buildReport(
  tx: TenantTx,
  config: BuilderConfig,
  range: Range,
): Promise<BuiltReport> {
  if (tx.actor.type !== "support") await assertOwner(tx);
  const src = SOURCES[config.source];
  const dim = src.dims[config.group];
  const rows =
    src.base === "hours"
      ? await hoursRows(tx, range)
      : (await runReport(tx, src.base, range)).rows;
  const groups = new Map<string, Report["rows"]>();
  for (const r of rows) {
    let key = String(r[dim.col] ?? "—");
    if (config.group === "method") key = METHOD_LABELS[key] ?? key;
    if (dim.date) {
      const day = key.slice(0, 10);
      key =
        config.group === "month"
          ? day.slice(0, 7) + "-01"
          : config.group === "week"
            ? weekOf(day)
            : day;
    }
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const measures = config.measures.map((m) => src.measures[m]);
  const value = (m: Measure, rs: Report["rows"]): number | null => {
    const total = (c: number) => rs.reduce((t, r) => t + Number(r[c] ?? 0), 0);
    if (m.count) return rs.length;
    if (m.sum !== undefined) return Math.round(total(m.sum) * 100) / 100;
    if (m.avgOf !== undefined)
      return rs.length ? Math.round(total(m.avgOf) / rs.length) : null;
    if (m.ratio) {
      // Only rows where both numbers are known (a job with no cost has no margin).
      const known = rs.filter(
        (r) => r[m.ratio![0]] !== null && r[m.ratio![1]] !== null,
      );
      const den = known.reduce((t, r) => t + Number(r[m.ratio![1]]), 0);
      return den
        ? Math.round(
            (known.reduce((t, r) => t + Number(r[m.ratio![0]]), 0) * 10000) /
              den,
          ) / 100
        : null;
    }
    return null;
  };
  const keys = [...groups.keys()].sort((a, b) =>
    dim.date
      ? a.localeCompare(b)
      : (value(measures[0], groups.get(b)!) ?? 0) -
        (value(measures[0], groups.get(a)!) ?? 0),
  );
  const out: Report["rows"] = keys.map((k) => [
    dim.date ? nice(k, config.group) : k,
    ...measures.map((m) => value(m, groups.get(k)!)),
  ]);
  const totals: Report["totals"] = [
    "Total",
    ...measures.map((m) => value(m, rows)),
  ];
  const first = measures[0];
  const bars = out.map((r) => ({
    label: String(r[0]),
    value: Number(r[1] ?? 0),
    money: !!first.money,
    percent: !!first.percent,
  }));
  const top = !dim.date && bars.length ? bars[0] : null;
  const fmt = (v: number | null, m: Measure) =>
    v === null
      ? "—"
      : m.money
        ? new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
          }).format(v / 100)
        : m.percent
          ? `${v}%`
          : String(v);
  return {
    title: `${measures.map((m) => m.label).join(", ")} by ${dim.label.toLowerCase()}`,
    columns: [
      { label: dim.label },
      ...measures.map((m) => ({
        label: m.percent ? `${m.label} (%)` : m.label,
        money: m.money,
      })),
    ],
    rows: out,
    totals,
    bars,
    headline: top
      ? `${top.label} leads with ${fmt(top.value, first)} ${first.label.toLowerCase()}.`
      : `${fmt(value(first, rows), first)} ${first.label.toLowerCase()} in total.`,
  };
}

// ---- Saved reports ----

export async function listSavedReports(tx: TenantTx) {
  const rows = await tx
    .select()
    .from(savedReport)
    .where(
      and(
        eq(savedReport.businessId, tx.businessId),
        isNull(savedReport.archivedAt),
      ),
    )
    .orderBy(desc(savedReport.pinned), asc(savedReport.name));
  return rows.map((r) => ({
    ...r,
    config: readConfig(r.config as Record<string, unknown>),
  }));
}

export async function saveReport(
  tx: TenantTx,
  meta: RequestMeta,
  input: { name: string; config: BuilderConfig; pinned: boolean },
) {
  await assertOwner(tx);
  const [row] = await tx
    .insert(savedReport)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      name: input.name.trim(),
      config: input.config,
      pinned: input.pinned,
    })
    .returning({ id: savedReport.id });
  await audit(tx, meta, {
    action: "report.saved",
    targetType: "saved_report",
    targetId: row.id,
    after: { name: input.name, config: input.config },
  });
  return { id: row.id };
}

export async function updateSavedReport(
  tx: TenantTx,
  meta: RequestMeta,
  input: { id: string; action: "pin" | "unpin" | "remove" },
) {
  await assertOwner(tx);
  const change =
    input.action === "remove"
      ? { archivedAt: new Date() }
      : { pinned: input.action === "pin" };
  const rows = await tx
    .update(savedReport)
    .set(change)
    .where(
      and(
        eq(savedReport.businessId, tx.businessId),
        eq(savedReport.id, input.id),
      ),
    )
    .returning({ id: savedReport.id });
  if (!rows.length) throw notFound("That report");
  await audit(tx, meta, {
    action: `report.${input.action}`,
    targetType: "saved_report",
    targetId: input.id,
    after: change,
  });
  return { id: input.id };
}

export const configQuery = (c: BuilderConfig) =>
  new URLSearchParams({
    source: c.source,
    group: c.group,
    measures: c.measures.join(","),
    range: c.range,
    view: c.view,
  }).toString();
