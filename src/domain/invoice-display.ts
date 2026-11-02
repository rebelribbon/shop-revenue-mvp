import { and, eq } from "drizzle-orm";
import { business, invoice } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { notFound } from "@/lib/errors";
import { invoiceDisplaySchema } from "@/lib/invoice-display";
import { assertOwner } from "./membership";
import { audit, type RequestMeta } from "./records";

export async function getInvoiceTemplate(tx: TenantTx) {
  const [b] = await tx
    .select({ display: business.invoiceDisplay })
    .from(business)
    .where(eq(business.id, tx.businessId));
  return b?.display ?? null;
}

// null resets the invoice to the business default.
export async function setInvoiceDisplay(
  tx: TenantTx,
  meta: RequestMeta,
  invoiceId: string,
  display: unknown,
) {
  const value = display === null ? null : invoiceDisplaySchema.parse(display);
  const [row] = await tx
    .update(invoice)
    .set({ display: value })
    .where(
      and(eq(invoice.businessId, tx.businessId), eq(invoice.id, invoiceId)),
    )
    .returning({ id: invoice.id });
  if (!row) throw notFound("That invoice");
  await audit(tx, meta, {
    action: "invoice.display_changed",
    targetType: "invoice",
    targetId: invoiceId,
    after: { display: value },
  });
  return { id: row.id };
}

export async function setInvoiceTemplate(
  tx: TenantTx,
  meta: RequestMeta,
  display: unknown,
) {
  await assertOwner(tx);
  const value = invoiceDisplaySchema.parse(display);
  await tx
    .update(business)
    .set({ invoiceDisplay: value })
    .where(eq(business.id, tx.businessId));
  await audit(tx, meta, {
    action: "business.invoice_template_changed",
    targetType: "business",
    targetId: tx.businessId,
    after: { display: value },
  });
  return { ok: true };
}
