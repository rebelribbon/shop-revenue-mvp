// Parts catalog with stock counts. Quantities are hundredths (1.5 = 150) so
// quarts of oil and feet of pipe count as easily as whole parts.
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { partItem, stockMove } from "@/db/schema";
import type { EstimateLine } from "@/db/schema/m3";
import type { TenantTx } from "@/db/tenant";
import { AppError, notFound } from "@/lib/errors";
import { audit, type RequestMeta } from "./records";

const cents = z.number().int().min(0).max(100_000_000);
const qty = z.number().int().min(-10_000_000).max(10_000_000);

export const partInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(200),
  partNumber: z
    .string()
    .trim()
    .max(100)
    .transform((v) => v || null)
    .nullable()
    .default(null),
  unitCostCents: cents.nullable().default(null),
  unitPriceCents: cents,
  reorderAtHundredths: cents.nullable().default(null),
});
export type PartInput = z.input<typeof partInput>;

export type Part = typeof partItem.$inferSelect & { low: boolean };

const withLow = (p: typeof partItem.$inferSelect): Part => ({
  ...p,
  low:
    p.reorderAtHundredths !== null &&
    p.onHandHundredths <= p.reorderAtHundredths,
});

// Low stock first, then A–Z.
export async function listParts(tx: TenantTx, query = "") {
  const q = query
    .trim()
    .slice(0, 100)
    .replace(/[\\%_]/g, "\\$&");
  const rows = await tx
    .select()
    .from(partItem)
    .where(
      and(
        eq(partItem.businessId, tx.businessId),
        isNull(partItem.archivedAt),
        q
          ? or(
              ilike(partItem.name, `%${q}%`),
              ilike(partItem.partNumber, `%${q}%`),
            )
          : undefined,
      ),
    )
    .orderBy(asc(sql`lower(${partItem.name})`))
    .limit(500);
  const parts = rows.map(withLow);
  return [...parts.filter((p) => p.low), ...parts.filter((p) => !p.low)];
}

export async function getPart(tx: TenantTx, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await tx
    .select()
    .from(partItem)
    .where(and(eq(partItem.businessId, tx.businessId), eq(partItem.id, id)));
  return row ? withLow(row) : null;
}

export async function stockHistory(tx: TenantTx, id: string) {
  return tx
    .select()
    .from(stockMove)
    .where(
      and(
        eq(stockMove.businessId, tx.businessId),
        eq(stockMove.partItemId, id),
      ),
    )
    .orderBy(desc(stockMove.createdAt))
    .limit(50);
}

export async function savePart(
  tx: TenantTx,
  meta: RequestMeta,
  raw: PartInput & { startingHundredths?: number },
) {
  const input = partInput.parse(raw);
  const taken = await tx
    .select({ id: partItem.id })
    .from(partItem)
    .where(
      and(
        eq(partItem.businessId, tx.businessId),
        isNull(partItem.archivedAt),
        sql`lower(${partItem.name}) = lower(${input.name})`,
      ),
    );
  if (taken.some((t) => t.id !== input.id))
    throw new AppError("CONFLICT", `“${input.name}” is already in your list.`);
  const values = {
    name: input.name,
    partNumber: input.partNumber,
    unitCostCents: input.unitCostCents,
    unitPriceCents: input.unitPriceCents,
    reorderAtHundredths: input.reorderAtHundredths,
  };
  if (input.id) {
    const [row] = await tx
      .update(partItem)
      .set(values)
      .where(
        and(eq(partItem.businessId, tx.businessId), eq(partItem.id, input.id)),
      )
      .returning();
    if (!row) throw notFound("That part");
    await audit(tx, meta, {
      action: "part.updated",
      targetType: "part_item",
      targetId: row.id,
      after: values,
    });
    return { id: row.id };
  }
  const [row] = await tx
    .insert(partItem)
    .values({
      ...values,
      businessId: tx.businessId,
      createdByUserId: tx.actor.type === "user" ? tx.actor.id : null,
    })
    .returning();
  await audit(tx, meta, {
    action: "part.created",
    targetType: "part_item",
    targetId: row.id,
    after: values,
  });
  const start = qty.parse(raw.startingHundredths ?? 0);
  if (start > 0)
    await moveStock(tx, row.id, start, "counted", { note: "Starting count" });
  return { id: row.id };
}

export async function archivePart(tx: TenantTx, meta: RequestMeta, id: string) {
  const [row] = await tx
    .update(partItem)
    .set({ archivedAt: new Date() })
    .where(and(eq(partItem.businessId, tx.businessId), eq(partItem.id, id)))
    .returning({ id: partItem.id });
  if (!row) throw notFound("That part");
  await audit(tx, meta, {
    action: "part.archived",
    targetType: "part_item",
    targetId: id,
  });
  return { id };
}

async function moveStock(
  tx: TenantTx,
  partItemId: string,
  change: number,
  reason: "received" | "used" | "returned" | "counted",
  extra: { invoiceId?: string; note?: string } = {},
) {
  if (change === 0) return;
  const [row] = await tx
    .update(partItem)
    .set({ onHandHundredths: sql`${partItem.onHandHundredths} + ${change}` })
    .where(
      and(eq(partItem.businessId, tx.businessId), eq(partItem.id, partItemId)),
    )
    .returning({ id: partItem.id });
  if (!row) return;
  await tx.insert(stockMove).values({
    businessId: tx.businessId,
    createdByUserId: tx.actor.type === "user" ? tx.actor.id : null,
    partItemId,
    changeHundredths: change,
    reason,
    invoiceId: extra.invoiceId ?? null,
    note: extra.note ?? null,
  });
}

// Parts came in: add them, and update the cost if it changed.
export async function receiveStock(
  tx: TenantTx,
  meta: RequestMeta,
  input: {
    partItemId: string;
    quantityHundredths: number;
    unitCostCents?: number | null;
  },
) {
  const part = await getPart(tx, input.partItemId);
  if (!part || part.archivedAt) throw notFound("That part");
  const n = qty.min(1).parse(input.quantityHundredths);
  await moveStock(tx, part.id, n, "received");
  if (
    input.unitCostCents !== undefined &&
    input.unitCostCents !== null &&
    input.unitCostCents !== part.unitCostCents
  )
    await tx
      .update(partItem)
      .set({ unitCostCents: cents.parse(input.unitCostCents) })
      .where(
        and(eq(partItem.businessId, tx.businessId), eq(partItem.id, part.id)),
      );
  await audit(tx, meta, {
    action: "part.received",
    targetType: "part_item",
    targetId: part.id,
    after: { quantityHundredths: n },
  });
  return { id: part.id, onHandHundredths: part.onHandHundredths + n };
}

// A shelf count: set on-hand to what's actually there.
export async function countStock(
  tx: TenantTx,
  meta: RequestMeta,
  input: { partItemId: string; countedHundredths: number },
) {
  const part = await getPart(tx, input.partItemId);
  if (!part || part.archivedAt) throw notFound("That part");
  const counted = qty.min(0).parse(input.countedHundredths);
  const change = counted - part.onHandHundredths;
  await moveStock(tx, part.id, change, "counted");
  await audit(tx, meta, {
    action: "part.counted",
    targetType: "part_item",
    targetId: part.id,
    before: { onHandHundredths: part.onHandHundredths },
    after: { onHandHundredths: counted },
  });
  return { id: part.id, change };
}

// Invoice issued: take its catalog parts off the shelf.
export async function takeStockForInvoice(
  tx: TenantTx,
  invoiceId: string,
  lines: EstimateLine[],
) {
  const used = new Map<string, number>();
  for (const l of lines)
    if (l.kind === "part" && l.partItemId)
      used.set(
        l.partItemId,
        (used.get(l.partItemId) ?? 0) + Math.round(l.quantity * 100),
      );
  for (const [id, n] of used)
    await moveStock(tx, id, -n, "used", { invoiceId });
}

// Invoice voided: put back whatever it took.
export async function returnStockForInvoice(tx: TenantTx, invoiceId: string) {
  const moves = await tx
    .select({
      partItemId: stockMove.partItemId,
      net: sql<string>`sum(${stockMove.changeHundredths})`,
    })
    .from(stockMove)
    .where(
      and(
        eq(stockMove.businessId, tx.businessId),
        eq(stockMove.invoiceId, invoiceId),
        inArray(stockMove.reason, ["used", "returned"]),
      ),
    )
    .groupBy(stockMove.partItemId);
  for (const m of moves)
    if (Number(m.net) < 0)
      await moveStock(tx, m.partItemId, -Number(m.net), "returned", {
        invoiceId,
      });
}

// For the job editor's picker.
export async function partCatalog(tx: TenantTx) {
  return (await listParts(tx)).map((p) => ({
    id: p.id,
    name: p.name,
    partNumber: p.partNumber,
    unitCostCents: p.unitCostCents,
    unitPriceCents: p.unitPriceCents,
    onHandHundredths: p.onHandHundredths,
  }));
}
export type CatalogPart = Awaited<ReturnType<typeof partCatalog>>[number];
