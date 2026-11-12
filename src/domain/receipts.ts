// Payment receipts: once a payment lands (online through Stripe or taken at
// the counter), the customer is emailed a receipt. Built in the payment's
// transaction, sent after it commits; a failed email never undoes a payment.
import { and, eq, sql } from "drizzle-orm";
import { business, customer, invoice, invoicePayment } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { safeErrorDiagnostic } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { openShareToken } from "@/lib/share-token";
import { emailProvider, type OutboundEmail } from "@/providers/email";
import { recordActivity } from "./records";

export type PreparedReceipt = { paymentId: string; email: OutboundEmail };

const money = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    c / 100,
  );
const methodText: Record<string, string> = {
  stripe: "Card (online)",
  card: "Card",
  external_card: "Card",
  cash: "Cash",
  check: "Check",
};

export async function prepareReceipt(
  tx: TenantTx,
  paymentId: string,
): Promise<PreparedReceipt | null> {
  const [row] = await tx
    .select({
      amountCents: invoicePayment.amountCents,
      method: invoicePayment.method,
      createdAt: invoicePayment.createdAt,
      invoiceId: invoice.id,
      number: invoice.number,
      totalCents: invoice.totalCents,
      snapshot: invoice.snapshot,
      sealed: invoice.shareTokenCiphertext,
      expiresAt: invoice.expiresAt,
      quoteId: invoice.quoteId,
      vehicleId: invoice.vehicleId,
      customerId: invoice.customerId,
      email: customer.email,
      firstName: customer.firstName,
      emailOff: customer.emailOptedOutAt,
      doNotContact: customer.doNotContact,
      dba: business.dba,
      legalName: business.legalName,
      timezone: business.timezone,
    })
    .from(invoicePayment)
    .innerJoin(
      invoice,
      and(
        eq(invoice.businessId, invoicePayment.businessId),
        eq(invoice.id, invoicePayment.invoiceId),
      ),
    )
    .innerJoin(
      customer,
      and(
        eq(customer.businessId, invoice.businessId),
        eq(customer.id, invoice.customerId),
      ),
    )
    .innerJoin(business, eq(business.id, invoice.businessId))
    .where(
      and(
        eq(invoicePayment.businessId, tx.businessId),
        eq(invoicePayment.id, paymentId),
      ),
    );
  if (!row || row.amountCents <= 0) return null;
  if (!row.email || row.emailOff || row.doNotContact) return null;
  const [sum] = await tx
    .select({
      paid: sql<string>`coalesce(sum(${invoicePayment.amountCents}),0)`,
    })
    .from(invoicePayment)
    .where(
      and(
        eq(invoicePayment.businessId, tx.businessId),
        eq(invoicePayment.invoiceId, row.invoiceId),
      ),
    );
  const balance = Math.max(0, row.totalCents - Number(sum?.paid ?? 0));
  const shopName = row.dba?.trim() || row.legalName;
  const base = process.env.APP_BASE_URL?.replace(/\/$/, "");
  let link: string | null = null;
  if (base && row.sealed && row.expiresAt > new Date())
    try {
      link = `${base}/invoice/${openShareToken(row.sealed)}`;
    } catch {
      link = null;
    }
  const when = row.createdAt.toLocaleString("en-US", {
    timeZone: row.timezone || "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const vehicle = row.snapshot.serviceLabel || row.snapshot.vehicleLabel || "";
  const text = [
    `Hi ${row.firstName || "there"},`,
    "",
    `Thank you. ${shopName} received your payment.`,
    "",
    `Amount paid: ${money(row.amountCents)}`,
    `Paid with: ${methodText[row.method] ?? row.method}`,
    `Date: ${when}`,
    `Invoice #${row.number}${vehicle ? ` · ${vehicle}` : ""}`,
    `Invoice total: ${money(row.totalCents)}`,
    balance > 0 ? `Balance remaining: ${money(balance)}` : "Paid in full.",
    "",
    "Work on this invoice:",
    ...row.snapshot.lines.map(
      (l) => `- ${l.description}: ${money(l.totalCents)}`,
    ),
    "",
    link ? `View your invoice: ${link}` : "",
    "",
    shopName,
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");
  await recordActivity(tx, {
    kind: "invoice.receipt_prepared",
    subjectType: row.vehicleId ? "vehicle" : "customer",
    subjectId: row.vehicleId ?? row.customerId,
    summary: `Receipt emailed for invoice #${row.number}`,
    data: { invoiceId: row.invoiceId, paymentId, jobId: row.quoteId },
  });
  return {
    paymentId,
    email: {
      to: row.email,
      subject: `Receipt from ${shopName}: invoice #${row.number}`,
      text,
      fromName: shopName,
      metadata: { kind: "payment_receipt", paymentId },
    },
  };
}

export async function sendReceipt(r: PreparedReceipt | null | undefined) {
  if (!r) return false;
  try {
    await emailProvider().send(r.email);
    return true;
  } catch (error) {
    logger.warn({
      event: "receipt.failed",
      paymentId: r.paymentId,
      ...safeErrorDiagnostic(error),
    });
    return false;
  }
}
