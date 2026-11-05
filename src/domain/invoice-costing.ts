// Invoice-month estimates use the approved lines and quote-time internal costs.
// Later revisions cannot silently rewrite a prior invoice's estimate.
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  activity,
  estimateVersion,
  invoice,
  type InvoiceSnapshot,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { jobInput } from "./jobs";
import { partLineCents } from "./job-costing";

export function quotedInvoiceCost(snapshot: InvoiceSnapshot, raw: unknown) {
  const parsed = jobInput.safeParse(raw);
  if (!parsed.success) return { costCents: null, estimatedLabor: false };
  let costCents = 0,
    estimatedLabor = false;
  for (const line of snapshot.lines) {
    const match = /^(part|labor)-(\d+)$/.exec(line.id);
    if (!match || match[1] !== line.kind)
      return { costCents: null, estimatedLabor };
    const index = Number(match[2]);
    if (line.kind === "part") {
      const p = parsed.data.parts[index];
      if (!p || p.description !== line.description || p.unitCostCents === null)
        return { costCents: null, estimatedLabor };
      costCents += partLineCents(line.quantity, p.unitCostCents);
    } else {
      const l = parsed.data.labor[index];
      if (!l || l.description !== line.description || l.costRateCents === null)
        return { costCents: null, estimatedLabor };
      costCents += Math.round(line.quantity * l.costRateCents);
      estimatedLabor = true;
    }
  }
  return { costCents, estimatedLabor };
}

export async function invoiceCosts(tx: TenantTx, ids: string[]) {
  const result = new Map<string, ReturnType<typeof quotedInvoiceCost>>();
  if (!ids.length) return result;
  const invoices = await tx
    .select({
      id: invoice.id,
      quoteId: invoice.quoteId,
      snapshot: invoice.snapshot,
      at: estimateVersion.createdAt,
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
      and(eq(invoice.businessId, tx.businessId), inArray(invoice.id, ids)),
    );
  const records = invoices.length
    ? await tx
        .select({
          id: activity.subjectId,
          data: activity.data,
          at: activity.occurredAt,
        })
        .from(activity)
        .where(
          and(
            eq(activity.businessId, tx.businessId),
            eq(activity.kind, "job.costed"),
            eq(activity.subjectType, "job"),
            inArray(activity.subjectId, [
              ...new Set(invoices.map((i) => i.quoteId)),
            ]),
          ),
        )
        .orderBy(desc(activity.occurredAt), desc(activity.id))
    : [];
  for (const i of invoices)
    result.set(
      i.id,
      quotedInvoiceCost(
        i.snapshot,
        records.find((r) => r.id === i.quoteId && r.at <= i.at)?.data,
      ),
    );
  return result;
}
