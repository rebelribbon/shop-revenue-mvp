// Service plans: recurring work started from one signed estimate. Visits are
// generated ~8 weeks ahead; completed visits are billed after each visit or
// monthly. All writes run inside the caller's tenant transaction.
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  appointment,
  business,
  estimateAuthorization,
  estimateVersion,
  invoice,
  servicePlan,
  type InvoiceSnapshot,
} from "@/db/schema";
import { withTenant, withGlobalWorker, type TenantTx } from "@/db/tenant";
import { AppError, notFound, safeErrorDiagnostic } from "@/lib/errors";
import { estimateTotals } from "@/lib/estimate-tax";
import { logger } from "@/lib/logger";
import {
  repeatInput,
  visitDate,
  visitsPerMonth,
  visitsThrough,
  type Repeat,
} from "@/lib/service-plans";
import { sealShareToken } from "@/lib/share-token";
import { addLocalDays, localDateKey, localDateTimeToUtc } from "@/lib/timezone";
import { newToken } from "@/lib/tokens";
import { audit, recordActivity, type RequestMeta } from "./records";

export const HORIZON_DAYS = 56;
export type ServicePlanRow = typeof servicePlan.$inferSelect;

async function shopSettings(tx: TenantTx) {
  const [b] = await tx
    .select()
    .from(business)
    .where(eq(business.id, tx.businessId));
  return b;
}
const todayIn = (timezone: string, now = new Date()) =>
  localDateKey(now, timezone);

// The signed start may have passed by the time work begins: keep the cadence
// (same weekday / day of month) and move to the first visit on or after today.
export function rollForward(r: Repeat, today: string): Repeat {
  if (r.startOn >= today) return r;
  let n = 0;
  while (visitDate(r, n) < today && n < 2000) n++;
  const startOn = visitDate(r, n);
  const until =
    r.until.kind === "visits"
      ? { kind: "visits" as const, count: Math.max(1, r.until.count) }
      : r.until;
  return { ...r, startOn, until };
}

async function latestApproved(tx: TenantTx, jobId: string) {
  const [row] = await tx
    .select({ version: estimateVersion, authorization: estimateAuthorization })
    .from(estimateVersion)
    .innerJoin(
      estimateAuthorization,
      and(
        eq(estimateAuthorization.businessId, estimateVersion.businessId),
        eq(estimateAuthorization.versionId, estimateVersion.id),
      ),
    )
    .where(
      and(
        eq(estimateVersion.businessId, tx.businessId),
        eq(estimateVersion.quoteId, jobId),
      ),
    )
    .orderBy(desc(estimateVersion.version))
    .limit(1);
  return row ?? null;
}

const approvedLines = (
  v: typeof estimateVersion.$inferSelect,
  a: typeof estimateAuthorization.$inferSelect,
) => v.snapshot.lines.filter((l) => a.approvedLineIds.includes(l.id));

export async function startServicePlan(
  tx: TenantTx,
  meta: RequestMeta,
  input: { jobId: string },
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${"plan:" + input.jobId},0))`,
  );
  const signed = await latestApproved(tx, input.jobId);
  if (!signed) throw notFound("An approved estimate for that job");
  const { version: v, authorization: a } = signed;
  const parsed = repeatInput.safeParse(v.snapshot.repeat);
  if (!parsed.success)
    throw new AppError(
      "VALIDATION",
      "This job doesn’t repeat. Use Start job instead.",
    );
  const lines = approvedLines(v, a);
  if (!lines.length)
    throw new AppError("VALIDATION", "The customer didn’t approve any work.");
  const [open] = await tx
    .select({ id: servicePlan.id })
    .from(servicePlan)
    .where(
      and(
        eq(servicePlan.businessId, tx.businessId),
        eq(servicePlan.quoteId, input.jobId),
        sql`${servicePlan.status} <> 'ended'`,
      ),
    );
  if (open)
    throw new AppError("CONFLICT", "This service plan is already running.");
  const shop = await shopSettings(tx);
  const today = todayIn(shop.timezone);
  const repeat = rollForward(parsed.data, today);
  const perVisitCents = estimateTotals(lines, v.snapshot.taxBps).totalCents;
  if (perVisitCents <= 0)
    throw new AppError("VALIDATION", "The approved work has no price.");
  const [plan] = await tx
    .insert(servicePlan)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.type === "user" ? tx.actor.id : null,
      customerId: v.customerId,
      vehicleId: v.vehicleId,
      serviceAssetId: v.serviceAssetId,
      quoteId: input.jobId,
      versionId: v.id,
      authorizationId: a.id,
      title: v.snapshot.title,
      repeat,
      perVisitCents,
      billing: repeat.billing,
    })
    .returning();
  const created = await ensurePlanVisits(tx, plan, today, shop.timezone);
  await audit(tx, meta, {
    action: "service_plan.started",
    targetType: "service_plan",
    targetId: plan.id,
    after: { jobId: input.jobId, repeat, perVisitCents },
  });
  await recordActivity(tx, {
    kind: "job.progress",
    subjectType: "job",
    subjectId: input.jobId,
    summary: "Service plan started",
    data: { versionId: v.id, servicePlanId: plan.id, status: "plan" },
  });
  return {
    id: plan.id,
    visitsScheduled: created,
    firstVisit: repeat.startOn,
    moved: repeat.startOn !== parsed.data.startOn,
  };
}

// Adds missing visits from today through the horizon. Skipped (cancelled)
// visits stay skipped; the unique index makes this safe to run repeatedly.
export async function ensurePlanVisits(
  tx: TenantTx,
  plan: ServicePlanRow,
  today: string,
  timezone: string,
) {
  if (plan.status !== "active") return 0;
  const through = addLocalDays(today, HORIZON_DAYS);
  const dates = visitsThrough(plan.repeat, through).filter(
    (d) => d.on >= today,
  );
  let created = 0;
  for (const { on } of dates) {
    const rows = await tx
      .insert(appointment)
      .values({
        businessId: tx.businessId,
        createdByUserId: tx.actor.type === "user" ? tx.actor.id : null,
        customerId: plan.customerId,
        vehicleId: plan.vehicleId,
        serviceAssetId: plan.serviceAssetId,
        startsAt: localDateTimeToUtc(
          `${on}T${plan.repeat.time ?? "09:00"}`,
          timezone,
        ),
        reason: plan.title,
        servicePlanId: plan.id,
        planVisitOn: on,
      })
      .onConflictDoNothing()
      .returning({ id: appointment.id });
    created += rows.length;
  }
  // A plan with a last visit date that has passed ends on its own.
  if (plan.repeat.until.kind !== "stopped") {
    const all = visitsThrough(plan.repeat, "9999-12-31");
    const last = all.at(-1)?.on;
    if (last && last < today)
      await tx
        .update(servicePlan)
        .set({
          status: "ended",
          endedAt: new Date(),
          endReason: "All visits done",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(servicePlan.businessId, tx.businessId),
            eq(servicePlan.id, plan.id),
          ),
        );
  }
  return created;
}

async function requirePlan(tx: TenantTx, id: string) {
  const [plan] = await tx
    .select()
    .from(servicePlan)
    .where(
      and(eq(servicePlan.businessId, tx.businessId), eq(servicePlan.id, id)),
    )
    .for("update");
  if (!plan) throw notFound("That service plan");
  return plan;
}

// Removes future visits that are still just booked (nothing done or linked).
async function clearFutureVisits(tx: TenantTx, planId: string) {
  await tx.execute(sql`DELETE FROM app.appointment a
    WHERE a.business_id=${tx.businessId} AND a.service_plan_id=${planId}
      AND a.status='scheduled' AND a.starts_at>=now() AND a.plan_invoice_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM app.estimate_version e WHERE e.business_id=a.business_id AND e.source_appointment_id=a.id)`);
}

export async function setServicePlanStatus(
  tx: TenantTx,
  meta: RequestMeta,
  input: {
    planId: string;
    action: "pause" | "resume" | "end";
    reason?: string;
  },
) {
  const plan = await requirePlan(tx, input.planId);
  if (plan.status === "ended")
    throw new AppError("INVALID_TRANSITION", "This plan has already ended.");
  const next =
    input.action === "pause"
      ? "paused"
      : input.action === "resume"
        ? "active"
        : "ended";
  if (next === plan.status)
    throw new AppError("INVALID_TRANSITION", "Nothing to change.");
  const now = new Date();
  const [row] = await tx
    .update(servicePlan)
    .set({
      status: next,
      pausedAt: next === "paused" ? now : null,
      endedAt: next === "ended" ? now : null,
      endReason: next === "ended" ? input.reason || "Ended by shop" : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(servicePlan.businessId, tx.businessId),
        eq(servicePlan.id, plan.id),
      ),
    )
    .returning();
  if (next !== "active") await clearFutureVisits(tx, plan.id);
  else {
    const shop = await shopSettings(tx);
    await ensurePlanVisits(tx, row, todayIn(shop.timezone), shop.timezone);
  }
  await audit(tx, meta, {
    action: `service_plan.${input.action}`,
    targetType: "service_plan",
    targetId: plan.id,
    before: { status: plan.status },
    after: { status: next, reason: input.reason ?? null },
  });
  await recordActivity(tx, {
    kind: "job.progress",
    subjectType: "job",
    subjectId: plan.quoteId,
    summary:
      next === "paused"
        ? "Service plan paused"
        : next === "active"
          ? "Service plan resumed"
          : "Service plan ended",
    data: { versionId: plan.versionId, servicePlanId: plan.id, status: "plan" },
  });
  return { id: plan.id, status: next };
}

const shortDay = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
const monthName = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });

// Bills completed, unbilled visits of a plan (optionally only those before a
// day). Returns null when there is nothing to bill.
export async function billPlanVisits(
  tx: TenantTx,
  meta: RequestMeta,
  planId: string,
  options: { visitIds?: string[]; before?: string } = {},
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${"invoice-number:" + tx.businessId},0))`,
  );
  const plan = await requirePlan(tx, planId);
  const visits = await tx
    .select()
    .from(appointment)
    .where(
      and(
        eq(appointment.businessId, tx.businessId),
        eq(appointment.servicePlanId, plan.id),
        eq(appointment.status, "completed"),
        isNull(appointment.planInvoiceId),
        options.visitIds
          ? inArray(appointment.id, options.visitIds)
          : undefined,
        options.before
          ? lt(appointment.planVisitOn, options.before)
          : undefined,
      ),
    )
    .orderBy(asc(appointment.planVisitOn))
    .for("update");
  if (!visits.length) return null;
  const [v] = await tx
    .select()
    .from(estimateVersion)
    .where(
      and(
        eq(estimateVersion.businessId, tx.businessId),
        eq(estimateVersion.id, plan.versionId),
      ),
    );
  const [a] = await tx
    .select()
    .from(estimateAuthorization)
    .where(
      and(
        eq(estimateAuthorization.businessId, tx.businessId),
        eq(estimateAuthorization.id, plan.authorizationId),
      ),
    );
  const base = approvedLines(v, a);
  const many = visits.length > 1;
  const lines = visits.flatMap((visit) =>
    base.map((l) => ({
      ...l,
      id: `${l.id}@${visit.planVisitOn}`,
      description: many
        ? `${l.description} (${shortDay(visit.planVisitOn!)})`
        : l.description,
    })),
  );
  const { subtotalCents, taxCents, totalCents } = estimateTotals(
    lines,
    v.snapshot.taxBps,
  );
  const shop = await shopSettings(tx);
  const first = visits[0].planVisitOn!;
  const title = many
    ? `${plan.title}: ${visits.length} visits${plan.billing === "monthly" ? `, ${monthName(first)}` : ""}`
    : `${plan.title}: visit on ${shortDay(first)}`;
  const snapshot: InvoiceSnapshot = {
    ...v.snapshot,
    title,
    lines,
    subtotalCents,
    taxCents,
    totalCents,
    shopPhone: shop.phoneE164,
    shopAddress: [
      shop.addressLine1,
      shop.addressLine2,
      shop.city,
      shop.region,
      shop.postalCode,
    ]
      .filter(Boolean)
      .join(", "),
  };
  const [sequence] = await tx
    .select({ number: sql<number>`coalesce(max(${invoice.number}),1000)+1` })
    .from(invoice)
    .where(eq(invoice.businessId, tx.businessId));
  const token = newToken();
  const [row] = await tx
    .insert(invoice)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.type === "user" ? tx.actor.id : null,
      number: Number(sequence.number),
      quoteId: plan.quoteId,
      versionId: plan.versionId,
      authorizationId: plan.authorizationId,
      customerId: plan.customerId,
      vehicleId: plan.vehicleId,
      serviceAssetId: plan.serviceAssetId,
      servicePlanId: plan.id,
      snapshot,
      totalCents,
      dueOn: null,
      invoiceTerms: "",
      tokenHash: token.hash,
      shareTokenCiphertext: sealShareToken(token.token),
      expiresAt: new Date(Date.now() + 90 * 86400000),
    })
    .returning();
  await tx
    .update(appointment)
    .set({ planInvoiceId: row.id, updatedAt: new Date() })
    .where(
      and(
        eq(appointment.businessId, tx.businessId),
        inArray(
          appointment.id,
          visits.map((x) => x.id),
        ),
      ),
    );
  await audit(tx, meta, {
    action: "invoice.issued",
    targetType: "invoice",
    targetId: row.id,
    after: {
      number: row.number,
      totalCents,
      servicePlanId: plan.id,
      visits: visits.map((x) => x.planVisitOn),
    },
  });
  await recordActivity(tx, {
    kind: "invoice.issued",
    subjectType: plan.vehicleId ? "vehicle" : "customer",
    subjectId: plan.vehicleId ?? plan.customerId,
    summary: `Invoice #${row.number} issued (${visits.length} visit${many ? "s" : ""})`,
    data: { invoiceId: row.id, servicePlanId: plan.id },
  });
  return {
    id: row.id,
    number: row.number,
    totalCents,
    path: `/invoice/${token.token}`,
  };
}

// Called when a visit's status changes. Billing per visit happens on Done;
// undoing a billed visit is refused so the invoice and the visit agree.
export async function onPlanVisitStatus(
  tx: TenantTx,
  meta: RequestMeta,
  visit: typeof appointment.$inferSelect,
  before: string,
) {
  if (!visit.servicePlanId) return null;
  if (before === "completed" && visit.planInvoiceId)
    throw new AppError(
      "INVALID_TRANSITION",
      "This visit is already on an invoice. Void that invoice first.",
    );
  if (visit.status !== "completed") return null;
  const [plan] = await tx
    .select()
    .from(servicePlan)
    .where(
      and(
        eq(servicePlan.businessId, tx.businessId),
        eq(servicePlan.id, visit.servicePlanId),
      ),
    );
  if (plan?.billing !== "per_visit") return null;
  return billPlanVisits(tx, meta, plan.id, { visitIds: [visit.id] });
}

// A voided plan invoice frees its visits so they can be billed again.
export async function releasePlanInvoice(tx: TenantTx, invoiceId: string) {
  await tx
    .update(appointment)
    .set({ planInvoiceId: null, updatedAt: new Date() })
    .where(
      and(
        eq(appointment.businessId, tx.businessId),
        eq(appointment.planInvoiceId, invoiceId),
      ),
    );
}

export type PlanSummary = ServicePlanRow & {
  done: number;
  skipped: number;
  unbilled: number;
  billedCents: number;
  next: { id: string; on: string; startsAt: Date }[];
};

export async function listServicePlans(
  tx: TenantTx,
  filter: { jobIds?: string[]; customerId?: string; activeOnly?: boolean } = {},
): Promise<PlanSummary[]> {
  const plans = await tx
    .select()
    .from(servicePlan)
    .where(
      and(
        eq(servicePlan.businessId, tx.businessId),
        filter.jobIds ? inArray(servicePlan.quoteId, filter.jobIds) : undefined,
        filter.customerId
          ? eq(servicePlan.customerId, filter.customerId)
          : undefined,
        filter.activeOnly ? eq(servicePlan.status, "active") : undefined,
      ),
    )
    .orderBy(desc(servicePlan.createdAt));
  if (filter.jobIds && !filter.jobIds.length) return [];
  if (!plans.length) return [];
  const ids = plans.map((p) => p.id);
  const visits = await tx
    .select({
      id: appointment.id,
      planId: appointment.servicePlanId,
      on: appointment.planVisitOn,
      startsAt: appointment.startsAt,
      status: appointment.status,
      invoiceId: appointment.planInvoiceId,
    })
    .from(appointment)
    .where(
      and(
        eq(appointment.businessId, tx.businessId),
        inArray(appointment.servicePlanId, ids),
      ),
    )
    .orderBy(asc(appointment.planVisitOn));
  const billed = await tx
    .select({
      planId: invoice.servicePlanId,
      cents: sql<string>`coalesce(sum(${invoice.totalCents}),0)`,
    })
    .from(invoice)
    .where(
      and(
        eq(invoice.businessId, tx.businessId),
        inArray(invoice.servicePlanId, ids),
        isNull(invoice.voidedAt),
      ),
    )
    .groupBy(invoice.servicePlanId);
  const now = new Date();
  return plans.map((p) => {
    const mine = visits.filter((x) => x.planId === p.id);
    return {
      ...p,
      done: mine.filter((x) => x.status === "completed").length,
      skipped: mine.filter((x) => x.status === "cancelled").length,
      unbilled: mine.filter((x) => x.status === "completed" && !x.invoiceId)
        .length,
      billedCents: Number(billed.find((b) => b.planId === p.id)?.cents ?? 0),
      next: mine
        .filter((x) => x.status === "scheduled" && x.startsAt >= now)
        .slice(0, 4)
        .map((x) => ({ id: x.id, on: x.on!, startsAt: x.startsAt })),
    };
  });
}

// "Recurring revenue": what active plans bring in per month, on average.
export async function recurringRevenue(tx: TenantTx) {
  const plans = await tx
    .select({
      perVisitCents: servicePlan.perVisitCents,
      repeat: servicePlan.repeat,
    })
    .from(servicePlan)
    .where(
      and(
        eq(servicePlan.businessId, tx.businessId),
        eq(servicePlan.status, "active"),
      ),
    );
  return {
    plans: plans.length,
    monthlyCents: Math.round(
      plans.reduce(
        (sum, p) => sum + p.perVisitCents * visitsPerMonth(p.repeat),
        0,
      ),
    ),
  };
}

// Daily: keep every active plan's calendar filled and send last month's
// monthly invoices. Each business runs in its own transaction.
export async function runServicePlanMaintenance(now = new Date()) {
  const ids = await withGlobalWorker(async (tx) => {
    const r = await tx.execute(sql`select app.service_plan_businesses() as id`);
    return r.rows.map((x) => String(x.id));
  });
  let ok = 0,
    failed = 0;
  for (const businessId of ids) {
    try {
      await withTenant(
        businessId,
        { type: "system", id: null },
        async (tx) => {
          const shop = await shopSettings(tx);
          const today = todayIn(shop.timezone, now);
          const monthStart = `${today.slice(0, 7)}-01`;
          const meta = { requestId: `plans-${businessId}-${today}`, ip: null };
          const plans = await tx
            .select()
            .from(servicePlan)
            .where(
              and(
                eq(servicePlan.businessId, businessId),
                inArray(servicePlan.status, ["active", "paused", "ended"]),
                gte(
                  servicePlan.updatedAt,
                  new Date(now.getTime() - 400 * 86400000),
                ),
              ),
            );
          for (const plan of plans) {
            if (plan.status === "active")
              await ensurePlanVisits(tx, plan, today, shop.timezone);
            if (plan.billing === "monthly")
              await billPlanVisits(tx, meta, plan.id, { before: monthStart });
          }
        },
        { role: "app" },
      );
      ok++;
    } catch (error) {
      failed++;
      logger.error({
        event: "service_plans.maintenance_failed",
        businessId,
        alert: true,
        ...safeErrorDiagnostic(error),
      });
    }
  }
  return { businesses: ids.length, ok, failed };
}
