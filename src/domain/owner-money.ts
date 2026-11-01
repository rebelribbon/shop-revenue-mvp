import { and, desc, eq, gte, lt, inArray, sql } from "drizzle-orm";
import {
  expense,
  business,
  invoice,
  invoicePayment,
  estimateVersion,
  activity,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { localDateKey, localMidnightToUtc } from "@/lib/timezone";
import { AppError, notFound } from "@/lib/errors";
import { assertOwner } from "./membership";
import { audit, type RequestMeta } from "./records";
import { jobInput } from "./jobs";
import { partLineCents } from "./job-costing";
import { z } from "zod";
export const expenseCategories = [
  "rent",
  "tools",
  "supplies",
  "utilities",
  "insurance",
  "marketing",
  "parts",
  "labor",
  "other",
] as const;
export const calendarDate = z
  .string()
  .regex(/^(19|20)\d{2}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T12:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Choose a valid date.");
export const expenseInput = z.object({
  spentOn: calendarDate,
  description: z.string().trim().min(1).max(200),
  category: z.enum(expenseCategories),
  amountCents: z.number().int().min(1).max(1000000000),
  includedInJobCost: z.boolean(),
});
export async function addExpense(
  tx: TenantTx,
  meta: RequestMeta,
  raw: z.infer<typeof expenseInput>,
) {
  await assertOwner(tx);
  const input = expenseInput.parse(raw);
  const [row] = await tx
    .insert(expense)
    .values({
      ...input,
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
    })
    .returning({ id: expense.id });
  await audit(tx, meta, {
    action: "expense.recorded",
    targetType: "expense",
    targetId: row.id,
    after: input,
  });
  return row;
}
export async function reverseExpense(
  tx: TenantTx,
  meta: RequestMeta,
  id: string,
  reason: string,
) {
  await assertOwner(tx);
  if (!reason.trim())
    throw new AppError("VALIDATION", "Enter a correction reason.");
  const [original] = await tx
    .select()
    .from(expense)
    .where(and(eq(expense.businessId, tx.businessId), eq(expense.id, id)));
  if (!original || original.amountCents <= 0) throw notFound("That expense");
  const [row] = await tx
    .insert(expense)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      spentOn: original.spentOn,
      description: original.description,
      category: original.category,
      amountCents: -original.amountCents,
      includedInJobCost: original.includedInJobCost,
      reversesExpenseId: id,
      reason,
    })
    .returning({ id: expense.id });
  await audit(tx, meta, {
    action: "expense.corrected",
    targetType: "expense",
    targetId: row.id,
    after: { originalId: id, reason },
  });
  return row;
}
export async function getOwnerMoney(
  tx: TenantTx,
  month?: string,
  now = new Date(),
  withProfit = true,
) {
  if (tx.actor.type !== "support") await assertOwner(tx);
  const [shop] = await tx
    .select()
    .from(business)
    .where(eq(business.id, tx.businessId));
  const key =
    month && /^(19|20)\d{2}-(0[1-9]|1[0-2])$/.test(month)
      ? month
      : localDateKey(now, shop.timezone).slice(0, 7);
  const startDay = key + "-01",
    next = new Date(startDay + "T12:00:00Z");
  next.setUTCMonth(next.getUTCMonth() + 1);
  const endDay = next.toISOString().slice(0, 10),
    start = localMidnightToUtc(startDay, shop.timezone),
    end = localMidnightToUtc(endDay, shop.timezone);
  const [received] = await tx
    .select({
      cents: sql<string>`coalesce(sum(${invoicePayment.amountCents}),0)`,
    })
    .from(invoicePayment)
    .where(
      and(
        eq(invoicePayment.businessId, tx.businessId),
        gte(invoicePayment.createdAt, start),
        lt(invoicePayment.createdAt, end),
      ),
    );
  // The sales-tax share of each payment (pro rata to its invoice), so the
  // owner sees money owed to the state separately from money the shop keeps.
  // A reversal or refund carries the same negative share as the payment it undoes.
  const [salesTax] = await tx
    .execute(
      sql`select coalesce(sum(round(p.amount_cents::numeric*coalesce((i.snapshot->>'taxCents')::numeric,0)/nullif(i.total_cents,0))),0)::text as cents from app.invoice_payment p join app.invoice i on i.business_id=p.business_id and i.id=p.invoice_id where p.business_id=${tx.businessId} and p.created_at>=${start} and p.created_at<${end}`,
    )
    .then((r) => r.rows);
  const [owed] = await tx
    .execute(
      sql`select coalesce(sum(greatest(i.total_cents-coalesce(p.paid,0),0)),0)::text as cents from app.invoice i left join lateral (select sum(amount_cents) paid from app.invoice_payment where business_id=i.business_id and invoice_id=i.id) p on true where i.business_id=${tx.businessId} and i.voided_at is null`,
    )
    .then((r) => r.rows);
  const rows = await tx
    .select()
    .from(expense)
    .where(
      and(
        eq(expense.businessId, tx.businessId),
        gte(expense.spentOn, startDay),
        lt(expense.spentOn, endDay),
      ),
    )
    .orderBy(desc(expense.spentOn), desc(expense.createdAt));
  const invoices = withProfit
    ? await tx
        .select({
          id: invoice.id,
          snapshot: invoice.snapshot,
          quoteId: invoice.quoteId,
          estimateCreatedAt: estimateVersion.createdAt,
        })
        .from(invoice)
        .innerJoin(
          estimateVersion,
          and(
            eq(estimateVersion.businessId, invoice.businessId),
            eq(estimateVersion.id, invoice.versionId),
          ),
        )
        .where(
          and(
            eq(invoice.businessId, tx.businessId),
            sql`${invoice.voidedAt} is null`,
            gte(invoice.createdAt, start),
            lt(invoice.createdAt, end),
          ),
        )
    : [];
  let salesCents = 0,
    costCents = 0,
    unknownCostJobs = 0,
    estimatedLaborJobs = 0;
  const records = invoices.length
    ? await tx
        .select({
          subjectId: activity.subjectId,
          data: activity.data,
          at: activity.occurredAt,
        })
        .from(activity)
        .where(
          and(
            eq(activity.businessId, tx.businessId),
            eq(activity.kind, "job.costed"),
            inArray(
              activity.subjectId,
              invoices.map((i) => i.quoteId),
            ),
          ),
        )
        .orderBy(desc(activity.occurredAt), desc(activity.id))
    : [];
  for (const inv of invoices) {
    salesCents += inv.snapshot.subtotalCents;
    const source = records.find(
      (r) => r.subjectId === inv.quoteId && r.at <= inv.estimateCreatedAt,
    );
    const parsed = jobInput.safeParse(source?.data);
    if (!parsed.success) {
      unknownCostJobs++;
      continue;
    }
    let estimated = false,
      unknown = false;
    for (const line of inv.snapshot.lines) {
      const index = Number(line.id.split("-")[1]);
      if (!Number.isInteger(index)) {
        unknown = true;
        continue;
      }
      if (line.kind === "part") {
        const p = parsed.data.parts[index];
        if (!p || p.description !== line.description) {
          unknown = true;
          continue;
        }
        costCents += partLineCents(line.quantity, p.unitCostCents);
      } else {
        const l = parsed.data.labor[index];
        if (!l || l.description !== line.description) {
          unknown = true;
          continue;
        }
        costCents += Math.round(line.quantity * l.costRateCents);
        estimated = true;
      }
    }
    if (unknown) unknownCostJobs++;
    if (estimated) estimatedLaborJobs++;
  }
  const expenseCents = rows.reduce((n, e) => n + e.amountCents, 0),
    overheadCents = rows
      .filter((e) => !e.includedInJobCost)
      .reduce((n, e) => n + e.amountCents, 0),
    collectedCents = Number(received.cents),
    salesTaxCents = Number((salesTax as { cents: string }).cents);
  const reversed = new Set(
    rows.filter((e) => e.reversesExpenseId).map((e) => e.reversesExpenseId),
  );
  return {
    month: key,
    timezone: shop.timezone,
    today: localDateKey(now, shop.timezone),
    salesCents,
    collectedCents,
    owedCents: Number(owed.cents),
    expenseCents,
    salesTaxCents,
    cashLeftCents: collectedCents - salesTaxCents - expenseCents,
    estimatedProfitCents:
      !withProfit || unknownCostJobs
        ? null
        : salesCents - costCents - overheadCents,
    costCents,
    unknownCostJobs,
    estimatedLaborJobs,
    expenses: rows.map((e) => ({ ...e, corrected: reversed.has(e.id) })),
  };
}
