// What a job actually makes: sales before tax, minus parts cost, labor cost
// (clocked hours when the techs used the clock, else entered actual hours,
// else quoted hours), minus estimated card fees on card payments.
import { and, eq, isNull, sql } from "drizzle-orm";
import { timeEntry } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError, notFound } from "@/lib/errors";
import { calculateJob, partLineCents } from "./job-costing";
import { getJob, jobInput } from "./jobs";
import { audit, type RequestMeta } from "./records";

// Typical card processing: 2.9% + 30¢ per card payment.
export const CARD_FEE_BPS = 290;
export const CARD_FEE_FIXED_CENTS = 30;

export type JobProfit = {
  salesCents: number;
  costCents: number | null;
  profitCents: number | null;
  marginBps: number | null;
  targetBps: number;
  belowTarget: boolean;
  laborBasis: "clocked" | "actual" | "quoted";
  clockedMinutes: number;
  cardFeesCents: number;
  // Why profit can't be shown yet (e.g. a part with no cost).
  missing: string[];
  partsCostCents: number | null;
  laborCostCents: number | null;
  // Line by line, as quoted: price, cost (null when not entered) and profit.
  lines: {
    kind: "part" | "labor";
    description: string;
    quantity: string;
    unitCostCents: number | null;
    costCents: number | null;
    priceCents: number;
  }[];
};

export async function jobProfit(
  tx: TenantTx,
  jobId: string,
  now = new Date(),
): Promise<JobProfit | null> {
  const job = await getJob(tx, jobId);
  if (!job) return null;
  const input = jobInput.parse(job.data);
  const base = calculateJob(input.parts, input.labor);
  const [biz] = (
    await tx.execute(
      sql`SELECT target_margin_bps, labor_cost_rate_cents FROM app.business WHERE id=${tx.businessId}`,
    )
  ).rows;
  const targetBps = Number(biz?.target_margin_bps ?? 4000);
  const shopCostRate = Number(biz?.labor_cost_rate_cents ?? 0);
  const [clock] = (
    await tx.execute(sql`
      SELECT coalesce(sum(extract(epoch FROM (coalesce(ended_at, ${now.toISOString()}::timestamptz) - started_at))),0)::bigint AS secs
      FROM app.time_entry WHERE business_id=${tx.businessId} AND job_id=${jobId}::uuid`)
  ).rows;
  const clockedMinutes = Math.floor(Number(clock?.secs ?? 0) / 60);
  const [fees] = (
    await tx.execute(sql`
      SELECT coalesce(sum(round(p.amount_cents * ${CARD_FEE_BPS} / 10000.0) + ${CARD_FEE_FIXED_CENTS}),0)::bigint AS cents
      FROM app.invoice_payment p JOIN app.invoice i ON i.business_id=p.business_id AND i.id=p.invoice_id
      WHERE p.business_id=${tx.businessId} AND i.quote_id=${jobId}::uuid AND p.method IN ('stripe','external_card') AND p.amount_cents>0`)
  ).rows;
  const cardFeesCents = Number(fees?.cents ?? 0);

  const missing: string[] = [];
  if (input.parts.some((p) => p.unitCostCents === null))
    missing.push("a part has no cost");
  const laborRates = input.labor.map((l) => l.costRateCents ?? shopCostRate);
  if (input.labor.length && laborRates.some((r) => !r))
    missing.push("no labor cost rate (Settings → Business)");

  let laborCost: number | null = 0;
  let laborBasis: JobProfit["laborBasis"] = "quoted";
  if (input.labor.length) {
    const rate =
      Math.round(laborRates.reduce((a, b) => a + b, 0) / laborRates.length) ||
      0;
    if (clockedMinutes > 0) {
      laborBasis = "clocked";
      laborCost = Math.round((clockedMinutes / 60) * rate);
    } else if (input.labor.every((l) => l.actualHoursHundredths !== null)) {
      laborBasis = "actual";
      laborCost = input.labor.reduce(
        (t, l, n) =>
          t +
          Math.round(((l.actualHoursHundredths ?? 0) / 100) * laborRates[n]),
        0,
      );
    } else
      laborCost = input.labor.reduce(
        (t, l, n) =>
          t + Math.round((l.estimatedHoursHundredths / 100) * laborRates[n]),
        0,
      );
  }
  const costCents =
    missing.length || base.partsCostCents === null
      ? null
      : base.partsCostCents + (laborCost ?? 0) + cardFeesCents;
  const profitCents =
    costCents === null ? null : base.subtotalCents - costCents;
  const marginBps =
    profitCents === null || base.subtotalCents === 0
      ? null
      : Math.round((profitCents * 10000) / base.subtotalCents);
  const lines: JobProfit["lines"] = [
    ...input.parts.map((p) => ({
      kind: "part" as const,
      description: p.description,
      quantity: String(p.quantity),
      unitCostCents: p.unitCostCents,
      costCents:
        p.unitCostCents === null
          ? null
          : partLineCents(p.quantity, p.unitCostCents),
      priceCents: partLineCents(p.quantity, p.unitPriceCents),
    })),
    ...input.labor.map((l, n) => {
      const hours = l.actualHoursHundredths ?? l.estimatedHoursHundredths;
      return {
        kind: "labor" as const,
        description: l.description,
        quantity: `${(hours / 100).toFixed(2)} h${l.actualHoursHundredths === null ? "" : " actual"}`,
        unitCostCents: laborRates[n] || null,
        costCents: laborRates[n]
          ? Math.round((hours / 100) * laborRates[n])
          : null,
        priceCents: Math.round(
          (l.estimatedHoursHundredths * l.sellRateCents) / 100,
        ),
      };
    }),
  ];
  return {
    // Each category on its own, so a missing labor rate doesn't hide what
    // the parts cost.
    partsCostCents: lines
      .filter((l) => l.kind === "part")
      .every((l) => l.costCents !== null)
      ? lines
          .filter((l) => l.kind === "part")
          .reduce((t, l) => t + (l.costCents ?? 0), 0)
      : null,
    laborCostCents:
      input.labor.length && laborRates.some((r) => !r) ? null : laborCost,
    lines,
    salesCents: base.subtotalCents,
    costCents,
    profitCents,
    marginBps,
    targetBps,
    belowTarget: marginBps !== null && marginBps < targetBps,
    laborBasis,
    clockedMinutes,
    cardFeesCents,
    missing,
  };
}

// The signed-in person's running clock, if any.
export async function myClock(tx: TenantTx) {
  if (tx.actor.type !== "user" || !tx.actor.id) return null;
  const userId = tx.actor.id;
  const [row] = await tx
    .select()
    .from(timeEntry)
    .where(
      and(
        eq(timeEntry.businessId, tx.businessId),
        eq(timeEntry.userId, userId),
        isNull(timeEntry.endedAt),
      ),
    );
  return row ?? null;
}

export async function startClock(
  tx: TenantTx,
  meta: RequestMeta,
  jobId: string,
) {
  if (tx.actor.type !== "user" || !tx.actor.id)
    throw new AppError("FORBIDDEN", "Only shop members can clock time.");
  const userId = tx.actor.id;
  if (!(await getJob(tx, jobId))) throw notFound("That job");
  const running = await myClock(tx);
  // Switching jobs stops the clock on the old one first.
  if (running) {
    if (running.jobId === jobId) return { id: running.id };
    await tx
      .update(timeEntry)
      .set({ endedAt: new Date() })
      .where(
        and(
          eq(timeEntry.businessId, tx.businessId),
          eq(timeEntry.id, running.id),
        ),
      );
  }
  const [row] = await tx
    .insert(timeEntry)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      jobId,
      userId,
    })
    .returning();
  await audit(tx, meta, {
    action: "time.clock_started",
    targetType: "job",
    targetId: jobId,
    after: { entryId: row.id },
  });
  return { id: row.id };
}

export async function stopClock(tx: TenantTx, meta: RequestMeta) {
  const running = await myClock(tx);
  if (!running)
    throw new AppError("INVALID_TRANSITION", "Your clock isn’t running.");
  await tx
    .update(timeEntry)
    .set({ endedAt: new Date() })
    .where(
      and(
        eq(timeEntry.businessId, tx.businessId),
        eq(timeEntry.id, running.id),
      ),
    );
  await audit(tx, meta, {
    action: "time.clock_stopped",
    targetType: "job",
    targetId: running.jobId,
    after: { entryId: running.id },
  });
  return { id: running.id, jobId: running.jobId };
}

export async function setTargetMargin(
  tx: TenantTx,
  meta: RequestMeta,
  percent: number,
) {
  const bps = Math.round(percent * 100);
  await tx.execute(
    sql`UPDATE app.business SET target_margin_bps=${bps} WHERE id=${tx.businessId}`,
  );
  await audit(tx, meta, {
    action: "business.target_margin_updated",
    targetType: "business",
    targetId: tx.businessId,
    after: { targetMarginBps: bps },
  });
  return { targetMarginBps: bps };
}
