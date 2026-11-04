// Monday summary email: last week's money and what needs attention now,
// sent to the shop's owner(s). On unless the owner turns it off.
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { business, weeklyReport } from "@/db/schema";
import { withGlobalWorker, withTenant, type TenantTx } from "@/db/tenant";
import { AppError, safeErrorDiagnostic } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { addLocalDays, localDateKey, localMidnightToUtc } from "@/lib/timezone";
import type { OutboundEmail } from "@/providers/email";
import { assertOwner } from "./membership";
import { listParts } from "./parts";
import { deliver, shopInfo } from "./payment-reminders";
import { loadPipeline } from "./pipeline";
import { audit, type RequestMeta } from "./records";
import { listTasks } from "./tasks";

export const weeklySettings = z.object({ on: z.boolean().default(true) });

export async function readWeeklySettings(tx: TenantTx) {
  const [row] = await tx
    .select({ v: business.weeklyReport })
    .from(business)
    .where(eq(business.id, tx.businessId));
  const parsed = weeklySettings.safeParse(row?.v ?? {});
  return parsed.success ? parsed.data : weeklySettings.parse({});
}

export async function saveWeeklySettings(
  tx: TenantTx,
  meta: RequestMeta,
  input: { on: boolean },
) {
  await assertOwner(tx);
  const value = weeklySettings.parse(input);
  await tx
    .update(business)
    .set({ weeklyReport: value })
    .where(eq(business.id, tx.businessId));
  await audit(tx, meta, {
    action: "weekly_report.saved",
    targetType: "business",
    targetId: tx.businessId,
    after: value,
  });
  return value;
}

// Monday of the week before `today` (both local date keys).
export function lastWeekStart(today: string) {
  const d = new Date(`${today}T12:00:00Z`);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return addLocalDays(today, -sinceMonday - 7);
}

export type WeeklyNumbers = {
  weekStart: string;
  weekEnd: string; // the Sunday
  collectedCents: number;
  payments: number;
  newCustomers: number;
  invoicedCents: number;
  invoices: number;
  estimatesSent: number;
  approved: number;
  unpaidCents: number;
  unpaidCount: number;
  openEstimateCents: number;
  openEstimates: number;
  inTheBay: number;
  tasksDue: number;
  lowStock: string[];
};

export async function weeklyNumbers(
  tx: TenantTx,
  weekStart: string,
  timezone: string,
  now = new Date(),
): Promise<WeeklyNumbers> {
  const from = localMidnightToUtc(weekStart, timezone);
  const to = localMidnightToUtc(addLocalDays(weekStart, 7), timezone);
  const r = await tx.execute(sql`
    SELECT
      (SELECT coalesce(sum(p.amount_cents),0) FROM app.invoice_payment p
        WHERE p.business_id=${tx.businessId} AND p.created_at>=${from} AND p.created_at<${to}) AS collected,
      (SELECT count(*) FROM app.invoice_payment p
        WHERE p.business_id=${tx.businessId} AND p.amount_cents>0 AND p.created_at>=${from} AND p.created_at<${to}) AS payments,
      (SELECT count(*) FROM app.customer c
        WHERE c.business_id=${tx.businessId} AND c.created_at>=${from} AND c.created_at<${to}) AS new_customers,
      (SELECT coalesce(sum(i.total_cents),0) FROM app.invoice i
        WHERE i.business_id=${tx.businessId} AND i.voided_at IS NULL AND i.created_at>=${from} AND i.created_at<${to}) AS invoiced,
      (SELECT count(*) FROM app.invoice i
        WHERE i.business_id=${tx.businessId} AND i.voided_at IS NULL AND i.created_at>=${from} AND i.created_at<${to}) AS invoices,
      (SELECT count(*) FROM app.estimate_version e
        WHERE e.business_id=${tx.businessId} AND e.created_at>=${from} AND e.created_at<${to}) AS estimates_sent,
      (SELECT count(*) FROM app.estimate_authorization a
        WHERE a.business_id=${tx.businessId} AND a.created_at>=${from} AND a.created_at<${to}) AS approved,
      (SELECT coalesce(sum(b.bal),0) FROM (SELECT i.total_cents - coalesce((SELECT sum(p.amount_cents) FROM app.invoice_payment p
          WHERE p.business_id=i.business_id AND p.invoice_id=i.id),0) AS bal
        FROM app.invoice i WHERE i.business_id=${tx.businessId} AND i.voided_at IS NULL) b WHERE b.bal>0) AS unpaid,
      (SELECT count(*) FROM (SELECT i.total_cents - coalesce((SELECT sum(p.amount_cents) FROM app.invoice_payment p
          WHERE p.business_id=i.business_id AND p.invoice_id=i.id),0) AS bal
        FROM app.invoice i WHERE i.business_id=${tx.businessId} AND i.voided_at IS NULL) b WHERE b.bal>0) AS unpaid_count`);
  const x = r.rows[0] ?? {};
  const [pipe, tasks, parts] = await Promise.all([
    loadPipeline(tx, now),
    listTasks(tx, now),
    listParts(tx),
  ]);
  return {
    weekStart,
    weekEnd: addLocalDays(weekStart, 6),
    collectedCents: Number(x.collected ?? 0),
    payments: Number(x.payments ?? 0),
    newCustomers: Number(x.new_customers ?? 0),
    invoicedCents: Number(x.invoiced ?? 0),
    invoices: Number(x.invoices ?? 0),
    estimatesSent: Number(x.estimates_sent ?? 0),
    approved: Number(x.approved ?? 0),
    unpaidCents: Number(x.unpaid ?? 0),
    unpaidCount: Number(x.unpaid_count ?? 0),
    openEstimateCents: pipe.totals.estimate.cents,
    openEstimates: pipe.totals.estimate.count,
    inTheBay: pipe.totals.working.count,
    tasksDue: tasks.due.length,
    lowStock: parts.filter((p) => p.low).map((p) => p.name),
  };
}

const money = (c: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(c / 100);
const day = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

export function composeWeekly(
  n: WeeklyNumbers,
  shopName: string,
  appUrl: string | null,
): Pick<OutboundEmail, "subject" | "text"> {
  const lines = [
    `${shopName}: your week, ${day(n.weekStart)}–${day(n.weekEnd)}`,
    "",
    "LAST WEEK",
    `Collected: ${money(n.collectedCents)} from ${plural(n.payments, "payment")}`,
    `Invoiced: ${money(n.invoicedCents)} on ${plural(n.invoices, "invoice")}`,
    `Estimates sent: ${n.estimatesSent} · approved: ${n.approved}`,
    `New customers: ${n.newCustomers}`,
    "",
    "NEEDS YOU NOW",
    n.unpaidCount
      ? `Unpaid: ${money(n.unpaidCents)} on ${plural(n.unpaidCount, "invoice")}`
      : "Unpaid: nothing — every invoice is paid",
    `Open estimates: ${plural(n.openEstimates, "job")} worth ${money(n.openEstimateCents)}`,
    `In the bay: ${plural(n.inTheBay, "job")}`,
    `Tasks due: ${n.tasksDue}`,
    n.lowStock.length
      ? `Running low: ${n.lowStock.slice(0, 8).join(", ")}${n.lowStock.length > 8 ? ` and ${n.lowStock.length - 8} more` : ""}`
      : "",
    "",
    appUrl ? `Open your shop: ${appUrl}/app` : "",
    "",
    "You get this every Monday. Turn it off in Settings → Follow-up rules.",
  ];
  return {
    subject: `${shopName} last week: ${money(n.collectedCents)} collected${n.unpaidCount ? `, ${money(n.unpaidCents)} unpaid` : ""}`,
    text: lines.filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n"),
  };
}

// The app's address for the "Open your shop" link; left out if unset.
function baseUrl() {
  return process.env.APP_BASE_URL?.replace(/\/$/, "") || null;
}

async function ownerEmails(tx: TenantTx) {
  const r = await tx.execute(sql`
    SELECT DISTINCT u.email FROM app.membership m JOIN app."user" u ON u.id=m.user_id
    WHERE m.business_id=${tx.businessId} AND m.role='owner' AND m.status='active' AND u.email IS NOT NULL`);
  return r.rows.map((x) => String(x.email));
}

export type PreparedWeekly = { weekStart: string; emails: OutboundEmail[] };

async function prepare(tx: TenantTx, now: Date): Promise<PreparedWeekly> {
  const shop = await shopInfo(tx);
  const weekStart = lastWeekStart(localDateKey(now, shop.timezone));
  const n = await weeklyNumbers(tx, weekStart, shop.timezone, now);
  const body = composeWeekly(n, shop.name, baseUrl());
  return {
    weekStart,
    emails: (await ownerEmails(tx)).map((to) => ({
      to,
      ...body,
      metadata: { kind: "weekly_report", weekStart },
    })),
  };
}

async function record(
  tx: TenantTx,
  weekStart: string,
  to: string,
  status: "sent" | "failed",
  automatic: boolean,
) {
  await tx.insert(weeklyReport).values({
    businessId: tx.businessId,
    createdByUserId: tx.actor.type === "user" ? tx.actor.id : null,
    weekStart,
    sentTo: to,
    status,
    automatic,
  });
}

// "Email me last week's summary now" (owner). Step 1, in the transaction.
export async function prepareWeeklyNow(tx: TenantTx, now = new Date()) {
  await assertOwner(tx);
  const p = await prepare(tx, now);
  const me = tx.actor.type === "user" ? tx.actor.id : null;
  const r = me
    ? await tx.execute(sql`SELECT email FROM app."user" WHERE id=${me}`)
    : null;
  const mine = r?.rows[0]?.email ? String(r.rows[0].email) : null;
  // By hand, it goes to the person who asked.
  const email = p.emails.find((e) => e.to === mine) ?? p.emails[0];
  if (!email)
    throw new AppError("VALIDATION", "Add an email to your account first.");
  return {
    weekStart: p.weekStart,
    emails: [{ ...email, to: mine ?? email.to }],
  };
}

// Step 2, after commit.
export async function sendPreparedWeekly(
  businessId: string,
  actor: Parameters<typeof withTenant>[1],
  p: PreparedWeekly,
) {
  let ok = 0;
  for (const e of p.emails) {
    const outcome = await deliver({ email: e });
    await withTenant(businessId, actor, (tx) =>
      record(tx, p.weekStart, e.to, outcome.status, false),
    );
    if (outcome.status === "sent") ok++;
  }
  return {
    message: ok
      ? `Summary emailed to ${p.emails.map((e) => e.to).join(", ")}.`
      : "The email couldn’t be sent right now. Try again in a few minutes.",
  };
}

// The daily job: on Monday through Wednesday (a missed Monday still goes
// out), once per week per shop.
export async function runWeeklyReports(now = new Date()) {
  const ids = await withGlobalWorker(async (tx) => {
    const r = await tx.execute(
      sql`select app.weekly_report_businesses() as id`,
    );
    return r.rows.map((x) => String(x.id));
  });
  let sent = 0,
    failed = 0,
    errors = 0;
  const system = { type: "system" as const, id: null };
  for (const businessId of ids) {
    try {
      const p = await withTenant(
        businessId,
        system,
        async (tx) => {
          const shop = await shopInfo(tx);
          const today = localDateKey(now, shop.timezone);
          const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
          if (weekday > 2) return null;
          const weekStart = lastWeekStart(today);
          const [already] = await tx
            .select({ id: weeklyReport.id })
            .from(weeklyReport)
            .where(
              and(
                eq(weeklyReport.businessId, tx.businessId),
                eq(weeklyReport.weekStart, weekStart),
                eq(weeklyReport.automatic, true),
                eq(weeklyReport.status, "sent"),
              ),
            )
            .limit(1);
          if (already) return null;
          return prepare(tx, now);
        },
        { role: "app" },
      );
      if (!p) continue;
      for (const e of p.emails) {
        const outcome = await deliver({ email: e });
        await withTenant(
          businessId,
          system,
          (tx) => record(tx, p.weekStart, e.to, outcome.status, true),
          { role: "app" },
        );
        if (outcome.status === "sent") sent++;
        else failed++;
      }
    } catch (error) {
      errors++;
      logger.error({
        event: "weekly_report.business_failed",
        businessId,
        requestId: `weekly-${randomUUID()}`,
        ...safeErrorDiagnostic(error),
      });
    }
  }
  return { sent, failed, errors };
}
