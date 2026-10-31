import { formatDateOnly } from "@/lib/timezone";
import { StripeButton } from "@/components/stripe-controls";
import { notFound } from "next/navigation";
import { readPublicInvoice } from "@/domain/invoices";
import { formatMoney } from "@/components/estimate-document";
import { PrintInvoice } from "@/components/invoice-controls";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Invoice | Shop Revenue",
  robots: { index: false, follow: false },
};
export default async function InvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const i = await readPublicInvoice(token);
  if (!i) notFound();
  const s = i.snapshot;
  return (
    <main id="main-content" tabIndex={-1}>
      <h1>Invoice #{i.number}</h1>
      <section className="card">
        <h2>{s.shopName}</h2>
        <p>{s.shopAddress}</p>
        <p>{s.shopPhone}</p>
        <p>
          {s.customerName} · {s.serviceLabel || s.vehicleLabel}
        </p>
        <h3>{s.title}</h3>
        <p>
          Issued:{" "}
          {new Date(i.issuedAt).toLocaleDateString("en-US", {
            timeZone: "America/Chicago",
          })}
          {i.dueOn
            ? ` · Due: ${formatDateOnly(i.dueOn)}`
            : i.terms.startsWith("Due on receipt.")
              ? " · Due on receipt"
              : " · Due date not specified"}
        </p>
        <ul>
          {s.lines.map((l) => (
            <li key={l.id}>
              {l.description} — {l.quantity} × {formatMoney(l.unitPriceCents)} ={" "}
              {formatMoney(l.totalCents)}
            </li>
          ))}
        </ul>
        <p>
          Subtotal: {formatMoney(s.subtotalCents)} · Tax:{" "}
          {formatMoney(s.taxCents)}
        </p>
        <p>
          Total: <strong>{formatMoney(i.totalCents)}</strong> · Paid:{" "}
          {formatMoney(i.paidCents)}
        </p>
        <p>
          Balance due:{" "}
          <strong>
            {formatMoney(i.voided ? 0 : i.totalCents - i.paidCents)}
          </strong>
        </p>
        <h2>
          {i.voided
            ? "Invoice void"
            : i.paidCents === i.totalCents
              ? "Paid in full"
              : i.paidCents > 0
                ? "Partially paid"
                : "Payment due"}
        </h2>
        {i.terms && <p style={{ whiteSpace: "pre-wrap" }}>{i.terms}</p>}
        {!i.voided && i.paidCents < i.totalCents && (
          <>
            {i.onlinePaymentEnabled &&
            Boolean(
              process.env.STRIPE_SECRET_KEY &&
              process.env.STRIPE_WEBHOOK_SECRET &&
              process.env.PAYMENTS_BASE_URL,
            ) ? (
              <>
                <StripeButton kind="pay" token={token} />
                <p className="muted">
                  Payment is confirmed after Stripe verifies it. If you just
                  paid, refresh this invoice shortly.
                </p>
              </>
            ) : (
              <p>Contact the shop to arrange payment.</p>
            )}
          </>
        )}
      </section>
      <PrintInvoice />
    </main>
  );
}
