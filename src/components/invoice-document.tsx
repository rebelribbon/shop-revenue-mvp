import type { ReactNode } from "react";
import type { InvoiceSnapshot } from "@/db/schema";
import type { InvoiceDisplay } from "@/lib/invoice-display";
import { formatDateOnly } from "@/lib/timezone";
import { formatMoney } from "./estimate-document";

export type InvoiceDocumentData = {
  number: number;
  snapshot: InvoiceSnapshot;
  issuedAt: string | Date;
  dueOn: string | null;
  terms: string;
  voided: boolean;
  totalCents: number;
  paidCents: number;
};

// The invoice exactly as the customer sees it; the in-app preview uses the
// same component so what you toggle is what they get.
export function InvoiceDocument({
  invoice: i,
  display: d,
  payment,
}: {
  invoice: InvoiceDocumentData;
  display: InvoiceDisplay;
  payment?: ReactNode;
}) {
  const s = i.snapshot;
  const balance = i.voided ? 0 : i.totalCents - i.paidCents;
  const target = s.serviceLabel || s.vehicleLabel;
  return (
    <section className="card invoice-document">
      <h2>{s.shopName}</h2>
      {d.shopAddress && s.shopAddress && <p>{s.shopAddress}</p>}
      {d.shopPhone && s.shopPhone && <p>{s.shopPhone}</p>}
      <p>
        <strong>Invoice #{i.number}</strong> · Issued{" "}
        {new Date(i.issuedAt).toLocaleDateString("en-US", {
          timeZone: "America/Chicago",
        })}
        {d.dueDate &&
          (i.dueOn
            ? ` · Due ${formatDateOnly(i.dueOn)}`
            : i.terms.startsWith("Due on receipt.")
              ? " · Due on receipt"
              : "")}
      </p>
      <p>
        Bill to: {s.customerName}
        {d.serviceLabel && target ? ` · ${target}` : ""}
      </p>
      {d.jobTitle && <h3>{s.title}</h3>}
      <ul>
        {s.lines.map((l) => (
          <li key={l.id}>
            {l.description}
            {d.lineDetail
              ? ` — ${l.quantity} × ${formatMoney(l.unitPriceCents)} = `
              : " — "}
            {formatMoney(l.totalCents)}
            {d.taxableLabels
              ? l.taxable === false
                ? " · Not taxable"
                : " · Taxable"
              : ""}
          </li>
        ))}
      </ul>
      <p>
        Subtotal: {formatMoney(s.subtotalCents)} · Sales tax ({s.taxBps / 100}
        %): {formatMoney(s.taxCents)}
      </p>
      <p>
        Total: <strong>{formatMoney(i.totalCents)}</strong>
        {d.paidSoFar && i.paidCents !== 0
          ? ` · Paid: ${formatMoney(i.paidCents)}`
          : ""}
      </p>
      <p>
        Balance due: <strong>{formatMoney(balance)}</strong>
      </p>
      <h2>
        {i.voided
          ? "Invoice void"
          : balance <= 0
            ? "Paid in full"
            : i.paidCents > 0
              ? "Partially paid"
              : "Payment due"}
      </h2>
      {d.terms && i.terms && (
        <p style={{ whiteSpace: "pre-wrap" }}>{i.terms}</p>
      )}
      {payment}
      {d.thankYou && d.thankYouText && <p>{d.thankYouText}</p>}
    </section>
  );
}
