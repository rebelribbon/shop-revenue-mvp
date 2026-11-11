import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import {
  expense,
  business,
  invoice,
  invoicePayment,
  estimateVersion,
  counterSale,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { localDateKey, localMidnightToUtc } from "@/lib/timezone";
import { AppError, notFound } from "@/lib/errors";
import { assertOwner } from "./membership";
import { audit, type RequestMeta } from "./records";
import { invoiceCosts } from "./invoice-costing";
import { saleLine } from "./counter-sales";
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
  // Quick sales at the counter count as money in (and their tax as owed).
  const [counter] = await tx
    .execute(
      sql`select coalesce(sum(total_cents),0)::text as total, coalesce(sum(tax_cents),0)::text as tax, coalesce(sum(subtotal_cents),0)::text as sub from app.counter_sale where business_id=${tx.businessId} and voided_at is null and created_at>=${start} and created_at<${end}`,
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
  const paidInvoices = withProfit
    ? await tx
        .selectDistinct({
          id: invoice.id,
          quoteId: invoice.quoteId,
          createdAt: invoice.createdAt,
          title: sql<string>`${invoice.snapshot}->>'title'`,
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
    : [];
  const costs = await invoiceCosts(tx, [
    ...new Set([...invoices, ...paidInvoices].map((i) => i.id)),
  ]);
  const missingCosts: { invoiceId: string; jobId: string; title: string }[] =
    [];
  for (const inv of invoices) {
    salesCents += inv.snapshot.subtotalCents;
    const cost = costs.get(inv.id);
    if (cost?.costCents == null) {
      unknownCostJobs++;
      missingCosts.push({
        invoiceId: inv.id,
        jobId: inv.quoteId,
        title: inv.snapshot.title,
      });
    } else costCents += cost.costCents;
    if (cost?.estimatedLabor) estimatedLaborJobs++;
  }
  const collectionMonths = [
    ...new Set(
      paidInvoices.map((i) =>
        localDateKey(i.createdAt, shop.timezone).slice(0, 7),
      ),
    ),
  ]
    .filter((m) => m !== key)
    .sort();
  const collectionMissingCosts = paidInvoices
    .filter((i) => costs.get(i.id)?.costCents == null)
    .map((i) => ({
      invoiceId: i.id,
      jobId: i.quoteId,
      title: i.title,
      month: localDateKey(i.createdAt, shop.timezone).slice(0, 7),
    }));
  const counterRows = withProfit
    ? await tx
        .select({ lines: counterSale.lines })
        .from(counterSale)
        .where(
          and(
            eq(counterSale.businessId, tx.businessId),
            sql`${counterSale.voidedAt} is null`,
            gte(counterSale.createdAt, start),
            lt(counterSale.createdAt, end),
          ),
        )
    : [];
  let unknownCounterSales = 0;
  for (const sale of counterRows) {
    const lines = saleLine.array().safeParse(sale.lines);
    if (!lines.success || lines.data.some((l) => l.unitCostCents === null)) {
      unknownCounterSales++;
      continue;
    }
    costCents += lines.data.reduce(
      (n, l) => n + Math.round((l.quantityHundredths * l.unitCostCents!) / 100),
      0,
    );
  }
  const expenseCents = rows.reduce((n, e) => n + e.amountCents, 0),
    overheadCents = rows
      .filter((e) => !e.includedInJobCost)
      .reduce((n, e) => n + e.amountCents, 0),
    collectedCents = Number(received.cents) + Number(counter.total),
    salesTaxCents =
      Number((salesTax as { cents: string }).cents) + Number(counter.tax);
  salesCents += Number(counter.sub);
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
      !withProfit ||
      unknownCostJobs ||
      unknownCounterSales ||
      (!invoices.length && !counterRows.length)
        ? null
        : salesCents - costCents - overheadCents,
    costCents,
    unknownCostJobs,
    unknownCounterSales,
    invoiceCount: invoices.length,
    counterSaleCount: counterRows.length,
    missingCosts,
    collectionMonths,
    collectionMissingCosts,
    estimatedLaborJobs,
    expenses: rows.map((e) => ({ ...e, corrected: reversed.has(e.id) })),
  };
}
