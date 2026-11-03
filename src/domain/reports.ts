// Owner reports for a date range, all from the same invoices, payments, jobs,
// plans and expenses the rest of the app uses. Each report is a plain table
// so the page and the CSV download show exactly the same thing.
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  activity,
  business,
  expense,
  invoice,
  invoicePayment,
  servicePlan,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { everyLabel, visitsPerMonth } from "@/lib/service-plans";
import { addLocalDays, localDateKey, localMidnightToUtc } from "@/lib/timezone";
import { assertOwner } from "./membership";

export const REPORTS = [
  {
    key: "sales",
    title: "Sales",
    about: "Every invoice issued in the range, with tax and what's still owed.",
  },
  {
    key: "payments",
    title: "Payments received",
    about: "Money that came in, by date and method. Refunds show as negatives.",
  },
  {
    key: "tax",
    title: "Sales tax",
    about:
      "Taxable and non-taxable sales and the tax you billed, by month, for filing.",
  },
  {
    key: "profit",
    title: "Profit by job",
    about:
      "Each invoiced job: what you billed (before tax), what it cost you, and what you kept.",
  },
  {
    key: "customers",
    title: "Top customers",
    about: "Who paid you the most in the range.",
  },
  {
    key: "recurring",
    title: "Service plans",
    about: "Every service plan and what it's worth per month.",
  },
  {
    key: "expenses",
    title: "Expenses",
    about: "Expenses you recorded, by category.",
  },
] as const;
export type ReportKey = (typeof REPORTS)[number]["key"];

// "money" columns hold cents; the page and CSV format them as dollars.
export type Report = {
  columns: { label: string; money?: boolean }[];
  rows: (string | number | null)[][];
  totals?: (string | number | null)[];
};

export type Range = { from: string; to: string };
export function presetRange(preset: string, today: string): Range {
  const [y, m] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const monthStart = (yy: number, mm: number) => `${yy}-${pad(mm)}-01`;
  const lastDay = (yy: number, mm: number) =>
    addLocalDays(mm === 12 ? `${yy + 1}-01-01` : monthStart(yy, mm + 1), -1);
  const q = Math.floor((m - 1) / 3) * 3 + 1;
  switch (preset) {
    case "last-month": {
      const yy = m === 1 ? y - 1 : y,
        mm = m === 1 ? 12 : m - 1;
      return { from: monthStart(yy, mm), to: lastDay(yy, mm) };
    }
    case "quarter":
      return { from: monthStart(y, q), to: lastDay(y, q + 2) };
    case "last-quarter": {
      const lq = q === 1 ? 10 : q - 3,
        yy = q === 1 ? y - 1 : y;
      return { from: monthStart(yy, lq), to: lastDay(yy, lq + 2) };
    }
    case "year":
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "last-year":
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default:
      return { from: monthStart(y, m), to: lastDay(y, m) };
  }
}

async function bounds(tx: TenantTx, r: Range) {
  const [shop] = await tx
    .select({ timezone: business.timezone })
    .from(business)
    .where(eq(business.id, tx.businessId));
  const tz = shop?.timezone || "America/Chicago";
  return {
    tz,
    start: localMidnightToUtc(r.from, tz),
    end: localMidnightToUtc(addLocalDays(r.to, 1), tz),
  };
}

export async function runReport(
  tx: TenantTx,
  key: ReportKey,
  range: Range,
): Promise<Report> {
  if (tx.actor.type !== "support") await assertOwner(tx);
  const { tz, start, end } = await bounds(tx, range);
  const day = (d: Date) => localDateKey(d, tz);
  const sum = (rows: Report["rows"], i: number) =>
    rows.reduce((s, r) => s + Number(r[i] ?? 0), 0);

  if (key === "sales" || key === "tax" || key === "profit") {
    const invoices = await tx
      .select()
      .from(invoice)
      .where(
        and(
          eq(invoice.businessId, tx.businessId),
          isNull(invoice.voidedAt),
          gte(invoice.createdAt, start),
          lt(invoice.createdAt, end),
        ),
      )
      .orderBy(invoice.createdAt);
    const paid = invoices.length
      ? await tx
          .select({
            id: invoicePayment.invoiceId,
            cents: sql<string>`coalesce(sum(${invoicePayment.amountCents}),0)`,
          })
          .from(invoicePayment)
          .where(
            and(
              eq(invoicePayment.businessId, tx.businessId),
              inArray(
                invoicePayment.invoiceId,
                invoices.map((i) => i.id),
              ),
            ),
          )
          .groupBy(invoicePayment.invoiceId)
      : [];
    const paidOf = (id: string) =>
      Number(paid.find((p) => p.id === id)?.cents ?? 0);
    if (key === "sales") {
      const rows = invoices.map((i) => [
        day(i.createdAt),
        `#${i.number}`,
        i.snapshot.customerName,
        i.snapshot.title,
        i.snapshot.subtotalCents,
        i.snapshot.taxCents,
        i.totalCents,
        paidOf(i.id),
        i.totalCents - paidOf(i.id),
      ]);
      return {
        columns: [
          { label: "Date" },
          { label: "Invoice" },
          { label: "Customer" },
          { label: "Job" },
          { label: "Before tax", money: true },
          { label: "Sales tax", money: true },
          { label: "Total", money: true },
          { label: "Paid", money: true },
          { label: "Still owed", money: true },
        ],
        rows,
        totals: [
          "Total",
          `${rows.length} invoices`,
          null,
          null,
          sum(rows, 4),
          sum(rows, 5),
          sum(rows, 6),
          sum(rows, 7),
          sum(rows, 8),
        ],
      };
    }
    if (key === "tax") {
      const months = new Map<string, number[]>();
      for (const i of invoices) {
        const m = day(i.createdAt).slice(0, 7);
        const taxable = i.snapshot.lines
          .filter((l) => l.taxable !== false)
          .reduce((s, l) => s + l.totalCents, 0);
        const row = months.get(m) ?? [0, 0, 0, 0];
        row[0] += taxable;
        row[1] += i.snapshot.subtotalCents - taxable;
        row[2] += i.snapshot.taxCents;
        row[3] += i.totalCents;
        months.set(m, row);
      }
      const rows = [...months.entries()].map(([m, v]) => [m, ...v]);
      return {
        columns: [
          { label: "Month" },
          { label: "Taxable sales", money: true },
          { label: "Non-taxable sales", money: true },
          { label: "Sales tax billed", money: true },
          { label: "Total billed", money: true },
        ],
        rows,
        totals: [
          "Total",
          sum(rows, 1),
          sum(rows, 2),
          sum(rows, 3),
          sum(rows, 4),
        ],
      };
    }
    // profit: the job's latest costing gives what it cost the shop.
    const jobIds = [...new Set(invoices.map((i) => i.quoteId))];
    const costs = jobIds.length
      ? await tx
          .selectDistinctOn([activity.subjectId], {
            id: activity.subjectId,
            data: activity.data,
          })
          .from(activity)
          .where(
            and(
              eq(activity.businessId, tx.businessId),
              eq(activity.kind, "job.costed"),
              inArray(activity.subjectId, jobIds),
            ),
          )
          .orderBy(activity.subjectId, desc(activity.occurredAt))
      : [];
    const rows = invoices.map((i) => {
      const totals = (
        costs.find((c) => c.id === i.quoteId)?.data as
          | {
              totals?: {
                subtotalCents?: number;
                actualCostCents?: number | null;
                estimatedCostCents?: number | null;
              };
            }
          | undefined
      )?.totals;
      const quoted = totals?.subtotalCents ?? 0;
      const fullCost = totals?.actualCostCents ?? totals?.estimatedCostCents;
      // Scale the job's cost to what was actually billed (approved work).
      const cost =
        fullCost == null || !quoted
          ? null
          : Math.round((fullCost * i.snapshot.subtotalCents) / quoted);
      const kept = cost === null ? null : i.snapshot.subtotalCents - cost;
      return [
        day(i.createdAt),
        `#${i.number}`,
        i.snapshot.customerName,
        i.snapshot.title,
        i.snapshot.subtotalCents,
        cost,
        kept,
        kept === null || !i.snapshot.subtotalCents
          ? "Add costs to see"
          : `${Math.round((kept / i.snapshot.subtotalCents) * 100)}%`,
      ];
    });
    const known = rows.filter((r) => r[5] !== null);
    return {
      columns: [
        { label: "Date" },
        { label: "Invoice" },
        { label: "Customer" },
        { label: "Job" },
        { label: "Billed before tax", money: true },
        { label: "Cost", money: true },
        { label: "Kept", money: true },
        { label: "Margin" },
      ],
      rows,
      totals: [
        "Total",
        `${rows.length} jobs`,
        null,
        known.length < rows.length
          ? `${rows.length - known.length} missing costs`
          : null,
        sum(rows, 4),
        sum(known, 5),
        sum(known, 6),
        sum(known, 4)
          ? `${Math.round((sum(known, 6) / sum(known, 4)) * 100)}%`
          : null,
      ],
    };
  }

  if (key === "payments" || key === "customers") {
    const payments = await tx
      .select({
        at: invoicePayment.createdAt,
        cents: invoicePayment.amountCents,
        method: invoicePayment.method,
        reference: invoicePayment.reference,
        number: invoice.number,
        customerId: invoice.customerId,
        customer: sql<string>`${invoice.snapshot}->>'customerName'`,
      })
      .from(invoicePayment)
      .innerJoin(
        invoice,
        and(
          eq(invoice.businessId, invoicePayment.businessId),
          eq(invoice.id, invoicePayment.invoiceId),
        ),
      )
      .where(
        and(
          eq(invoicePayment.businessId, tx.businessId),
          gte(invoicePayment.createdAt, start),
          lt(invoicePayment.createdAt, end),
        ),
      )
      .orderBy(invoicePayment.createdAt);
    if (key === "payments") {
      const rows = payments.map((p) => [
        day(p.at),
        `#${p.number}`,
        p.customer,
        p.method.replaceAll("_", " "),
        p.reference || null,
        p.cents,
      ]);
      return {
        columns: [
          { label: "Date" },
          { label: "Invoice" },
          { label: "Customer" },
          { label: "Method" },
          { label: "Reference" },
          { label: "Amount", money: true },
        ],
        rows,
        totals: [
          "Total",
          `${rows.length} payments`,
          null,
          null,
          null,
          sum(rows, 5),
        ],
      };
    }
    const by = new Map<
      string,
      { name: string; cents: number; count: number }
    >();
    for (const p of payments) {
      const c = by.get(p.customerId) ?? {
        name: p.customer,
        cents: 0,
        count: 0,
      };
      c.cents += p.cents;
      c.count += 1;
      by.set(p.customerId, c);
    }
    const rows = [...by.values()]
      .sort((a, b) => b.cents - a.cents)
      .map((c) => [c.name, c.count, c.cents]);
    return {
      columns: [
        { label: "Customer" },
        { label: "Payments" },
        { label: "Paid you", money: true },
      ],
      rows,
      totals: ["Total", sum(rows, 1), sum(rows, 2)],
    };
  }

  if (key === "recurring") {
    const plans = await tx
      .select()
      .from(servicePlan)
      .where(eq(servicePlan.businessId, tx.businessId))
      .orderBy(desc(servicePlan.createdAt));
    const rows = plans.map((p) => [
      p.title,
      p.status === "active"
        ? "Running"
        : p.status === "paused"
          ? "Paused"
          : "Ended",
      everyLabel(p.repeat),
      p.perVisitCents,
      p.status === "active"
        ? Math.round(p.perVisitCents * visitsPerMonth(p.repeat))
        : 0,
      day(p.createdAt),
    ]);
    return {
      columns: [
        { label: "Plan" },
        { label: "Status" },
        { label: "Repeats" },
        { label: "Per visit", money: true },
        { label: "Per month", money: true },
        { label: "Started" },
      ],
      rows,
      totals: ["Total", `${rows.length} plans`, null, null, sum(rows, 4), null],
    };
  }

  const expenses = await tx
    .select()
    .from(expense)
    .where(
      and(
        eq(expense.businessId, tx.businessId),
        gte(expense.spentOn, range.from),
        lt(expense.spentOn, addLocalDays(range.to, 1)),
      ),
    )
    .orderBy(expense.spentOn);
  const rows = expenses.map((e) => [
    e.spentOn,
    e.category,
    e.description,
    e.amountCents,
  ]);
  return {
    columns: [
      { label: "Date" },
      { label: "Category" },
      { label: "Description" },
      { label: "Amount", money: true },
    ],
    rows,
    totals: ["Total", `${rows.length} expenses`, null, sum(rows, 3)],
  };
}

const cell = (v: string | number | null, money?: boolean) => {
  if (v === null || v === undefined) return "";
  const s = money && typeof v === "number" ? (v / 100).toFixed(2) : String(v);
  return /[",\n]/.test(s) || /^[=+\-@]/.test(s)
    ? `"${(/^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? "'" : "") + s.replaceAll('"', '""')}"`
    : s;
};
export function reportCsv(r: Report) {
  const lines = [
    r.columns.map((c) => cell(c.label)).join(","),
    ...r.rows.map((row) =>
      row.map((v, i) => cell(v, r.columns[i]?.money)).join(","),
    ),
    ...(r.totals
      ? [r.totals.map((v, i) => cell(v, r.columns[i]?.money)).join(",")]
      : []),
  ];
  return lines.join("\r\n") + "\r\n";
}
