// Quick sale at the counter: parts or items with no job, paid on the spot.
// A receipt, not an invoice (invoices keep their signed-estimate trail).
// Catalog parts come off the shelf; a sale can be voided the same day,
// before the drawer is closed, which puts the parts back.
import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { business, counterSale, partItem, registerClose } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError, notFound } from "@/lib/errors";
import { localDateKey, localMidnightToUtc, addLocalDays } from "@/lib/timezone";
import { moveStock } from "./parts";
import { audit, type RequestMeta } from "./records";

export const saleLine = z.object({
  partItemId: z.uuid().optional(),
  description: z.string().trim().min(1).max(200),
  quantityHundredths: z.number().int().min(1).max(10_000_000),
  unitPriceCents: z.number().int().min(0).max(100_000_000),
  unitCostCents: z
    .number()
    .int()
    .min(0)
    .max(100_000_000)
    .nullable()
    .default(null),
  taxable: z.boolean().default(true),
});
export type SaleLine = z.infer<typeof saleLine>;

export const saleInput = z.object({
  lines: z
    .array(
      z.object({
        partItemId: z.uuid().optional(),
        description: z.string().trim().max(200).default(""),
        quantityHundredths: z.number().int().min(1).max(10_000_000),
        // Required for one-off items; catalog parts use their list price.
        unitPriceCents: z.number().int().min(0).max(100_000_000).optional(),
      }),
    )
    .min(1, "Add something to sell.")
    .max(50),
  chargeTax: z.boolean(),
  method: z.enum(["cash", "external_card", "check"]),
  reference: z.string().trim().max(100).default(""),
  receivedCents: z
    .number()
    .int()
    .min(0)
    .max(100_000_000)
    .nullable()
    .default(null),
});
export type SaleInput = z.input<typeof saleInput>;

const lineCents = (l: SaleLine) =>
  Math.round((l.quantityHundredths * l.unitPriceCents) / 100);

async function shop(tx: TenantTx) {
  const [b] = await tx
    .select({
      timezone: business.timezone,
      taxRateBps: business.taxRateBps,
      partsTaxable: business.partsTaxableDefault,
    })
    .from(business)
    .where(eq(business.id, tx.businessId));
  return {
    timezone: b?.timezone ?? "America/Chicago",
    taxRateBps: b?.taxRateBps ?? 0,
    partsTaxable: b?.partsTaxable ?? true,
  };
}

export async function quickSaleSettings(tx: TenantTx) {
  return shop(tx);
}

export async function createCounterSale(
  tx: TenantTx,
  meta: RequestMeta,
  raw: SaleInput,
) {
  const input = saleInput.parse(raw);
  const s = await shop(tx);
  const lines: SaleLine[] = [];
  for (const l of input.lines) {
    if (l.partItemId) {
      const [p] = await tx
        .select()
        .from(partItem)
        .where(
          and(
            eq(partItem.businessId, tx.businessId),
            eq(partItem.id, l.partItemId),
            isNull(partItem.archivedAt),
          ),
        );
      if (!p) throw notFound("That part");
      lines.push(
        saleLine.parse({
          partItemId: p.id,
          description: p.name,
          quantityHundredths: l.quantityHundredths,
          unitPriceCents: p.unitPriceCents,
          unitCostCents: p.unitCostCents,
          taxable: input.chargeTax,
        }),
      );
    } else {
      if (!l.description || l.unitPriceCents === undefined)
        throw new AppError(
          "VALIDATION",
          "Give each extra item a name and a price.",
        );
      lines.push(
        saleLine.parse({
          description: l.description,
          quantityHundredths: l.quantityHundredths,
          unitPriceCents: l.unitPriceCents,
          taxable: input.chargeTax,
        }),
      );
    }
  }
  const subtotal = lines.reduce((t, l) => t + lineCents(l), 0);
  const taxBps = input.chargeTax ? s.taxRateBps : 0;
  const taxable = lines
    .filter((l) => l.taxable)
    .reduce((t, l) => t + lineCents(l), 0);
  const tax = Math.round((taxable * taxBps) / 10000);
  const total = subtotal + tax;
  if (total <= 0)
    throw new AppError("VALIDATION", "The sale has to be more than $0.");
  if (
    input.method === "cash" &&
    input.receivedCents !== null &&
    input.receivedCents < total
  )
    throw new AppError(
      "VALIDATION",
      "The cash received is less than the total.",
    );

  // One number at a time per shop.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('counter_sale:' || ${tx.businessId}))`,
  );
  const r = await tx.execute(
    sql`SELECT coalesce(max(number),0)+1 AS n FROM app.counter_sale WHERE business_id=${tx.businessId}`,
  );
  const [row] = await tx
    .insert(counterSale)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.type === "user" ? tx.actor.id : null,
      number: Number(r.rows[0].n),
      lines,
      subtotalCents: subtotal,
      taxBps,
      taxCents: tax,
      totalCents: total,
      method: input.method,
      reference: input.reference || null,
      receivedCents: input.method === "cash" ? input.receivedCents : null,
    })
    .returning();
  const used = new Map<string, number>();
  for (const l of lines)
    if (l.partItemId)
      used.set(
        l.partItemId,
        (used.get(l.partItemId) ?? 0) + l.quantityHundredths,
      );
  for (const [id, n] of used)
    await moveStock(tx, id, -n, "used", { counterSaleId: row.id });
  await audit(tx, meta, {
    action: "counter_sale.created",
    targetType: "counter_sale",
    targetId: row.id,
    after: { number: row.number, totalCents: total, method: input.method },
  });
  return {
    id: row.id,
    number: row.number,
    totalCents: total,
    changeCents:
      input.method === "cash" && input.receivedCents !== null
        ? input.receivedCents - total
        : 0,
  };
}

export async function getCounterSale(tx: TenantTx, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await tx
    .select()
    .from(counterSale)
    .where(
      and(eq(counterSale.businessId, tx.businessId), eq(counterSale.id, id)),
    );
  if (!row) return null;
  const s = await shop(tx);
  const sameDay =
    localDateKey(row.createdAt, s.timezone) ===
    localDateKey(new Date(), s.timezone);
  const [closed] = await tx
    .select({ id: registerClose.id })
    .from(registerClose)
    .where(
      and(
        eq(registerClose.businessId, tx.businessId),
        eq(registerClose.day, localDateKey(row.createdAt, s.timezone)),
      ),
    );
  return {
    ...row,
    lines: z.array(saleLine).parse(row.lines),
    canVoid: !row.voidedAt && sameDay && !closed,
  };
}

export async function voidCounterSale(
  tx: TenantTx,
  meta: RequestMeta,
  input: { id: string; reason: string },
) {
  const sale = await getCounterSale(tx, input.id);
  if (!sale) throw notFound("That sale");
  const reason = input.reason.trim();
  if (!reason)
    throw new AppError("VALIDATION", "Say why you’re voiding this sale.");
  if (!sale.canVoid)
    throw new AppError(
      "INVALID_TRANSITION",
      sale.voidedAt
        ? "This sale is already voided."
        : "Sales can only be voided the same day, before the drawer is closed.",
    );
  await tx
    .update(counterSale)
    .set({
      voidedAt: new Date(),
      voidedByUserId: tx.actor.type === "user" ? tx.actor.id : null,
      voidReason: reason.slice(0, 500),
    })
    .where(
      and(
        eq(counterSale.businessId, tx.businessId),
        eq(counterSale.id, sale.id),
      ),
    );
  for (const l of sale.lines)
    if (l.partItemId)
      await moveStock(tx, l.partItemId, l.quantityHundredths, "returned", {
        counterSaleId: sale.id,
      });
  await audit(tx, meta, {
    action: "counter_sale.voided",
    targetType: "counter_sale",
    targetId: sale.id,
    after: { reason },
  });
  return { id: sale.id };
}

// Sales (not voided) in [from, to), for the register and reports.
export async function countersBetween(tx: TenantTx, from: Date, to: Date) {
  return tx
    .select()
    .from(counterSale)
    .where(
      and(
        eq(counterSale.businessId, tx.businessId),
        isNull(counterSale.voidedAt),
        gte(counterSale.createdAt, from),
        lt(counterSale.createdAt, to),
      ),
    )
    .orderBy(counterSale.createdAt);
}

export async function salesOnDay(tx: TenantTx, day: string) {
  const s = await shop(tx);
  return tx
    .select()
    .from(counterSale)
    .where(
      and(
        eq(counterSale.businessId, tx.businessId),
        gte(counterSale.createdAt, localMidnightToUtc(day, s.timezone)),
        lt(
          counterSale.createdAt,
          localMidnightToUtc(addLocalDays(day, 1), s.timezone),
        ),
      ),
    )
    .orderBy(desc(counterSale.createdAt));
}
