import Link from "next/link";
import { StripeButton, StripeRefundForm } from "@/components/stripe-controls";
import { invoiceCheckout, invoiceRefund } from "@/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import { activeCheckoutStates } from "@/domain/payments";
import { withTenant } from "@/db/tenant";
import { listEstimates } from "@/domain/estimates";
import { listInvoices } from "@/domain/invoices";
import { requireShopSession } from "@/server/views/shop";
import {
  InvoiceIssuer,
  InvoiceLink,
  InvoicePaymentForm,
} from "@/components/invoice-controls";
import { ActionForm } from "@/components/action-form";
import { formatMoney } from "@/components/estimate-document";
import {
  reverseInvoicePaymentAction,
  voidInvoiceAction,
} from "@/server/actions/invoices";
export default async function InvoicesPage() {
  const s = await requireShopSession("/app/invoices");
  const data = await withTenant(s.businessId, s.actor, async (tx) => ({
    invoices: await listInvoices(tx),
    estimates: await listEstimates(tx),
    checkouts: await tx
      .select()
      .from(invoiceCheckout)
      .where(
        and(
          eq(invoiceCheckout.businessId, tx.businessId),
          inArray(invoiceCheckout.status, activeCheckoutStates),
        ),
      ),
    refunds: await tx
      .select()
      .from(invoiceRefund)
      .where(eq(invoiceRefund.businessId, tx.businessId)),
  }));
  const choices = data.estimates
    .filter(
      (e, i, a) =>
        a.findIndex((x) => x.quoteId === e.quoteId) === i &&
        e.authorization &&
        e.authorization.approvedLineIds.length > 0 &&
        !data.invoices.some(
          (inv) => inv.quoteId === e.quoteId && !inv.voidedAt,
        ),
    )
    .map((e) => ({
      id: e.id,
      label: `${e.snapshot.title} · Version ${e.version} · ${e.snapshot.customerName}`,
    }));
  return (
    <main>
      <h1>Invoices &amp; payments</h1>
      <p>
        <Link href="/app/estimates">Estimates and authorization</Link>
      </p>
      <p className="muted">
        Record cash, checks, transfers, and verified online payments.
      </p>
      <p>
        <Link href="/app/settings/payments">Online payment setup</Link>
      </p>
      {Boolean(process.env.STRIPE_SECRET_KEY) && s.actor.type !== "support" && (
        <StripeButton kind="reconcile" />
      )}
      <InvoiceIssuer choices={choices} />
      <h2>Issued invoices</h2>
      {!data.invoices.length && <p>No invoices issued yet.</p>}
      {data.invoices.map((i) => (
        <article className="card" key={i.id}>
          <h2>
            Invoice #{i.number} · {i.snapshot.title}
          </h2>
          <p>
            {i.snapshot.customerName} · {i.snapshot.vehicleLabel}
          </p>
          <p>
            <strong>
              {i.voidedAt
                ? "Void"
                : i.balanceCents === 0
                  ? "Paid"
                  : i.paidCents > 0
                    ? "Partially paid"
                    : "Payment due"}
            </strong>
          </p>
          <p>
            Total: {formatMoney(i.totalCents)} · Paid:{" "}
            {formatMoney(i.paidCents)} · Balance:{" "}
            <strong>{formatMoney(i.voidedAt ? 0 : i.balanceCents)}</strong>
          </p>
          {i.dueOn && <p>Due: {i.dueOn}</p>}
          {i.voidReason && <p>Void reason: {i.voidReason}</p>}
          <InvoiceLink id={i.id} />
          <h3>Payment history</h3>
          {!i.entries.length && <p>No payments recorded.</p>}
          {i.entries.map((p) => (
            <div key={p.id}>
              <p>
                {formatMoney(p.amountCents)} · {p.method.replaceAll("_", " ")} ·{" "}
                {p.createdAt.toLocaleString("en-US", {
                  timeZone: "America/Chicago",
                })}
              </p>
              {p.reference && <p>Reference: {p.reference}</p>}
              {p.reason && <p>Reason: {p.reason}</p>}
              {s.role === "owner" &&
                !i.voidedAt &&
                p.amountCents > 0 &&
                p.method !== "stripe" &&
                !i.entries.some((e) => e.reversesPaymentId === p.id) && (
                  <details>
                    <summary>Correct this entry</summary>
                    <ActionForm
                      action={reverseInvoicePaymentAction}
                      hidden={{ paymentId: p.id }}
                      submitLabel="Reverse recorded entry"
                      confirm="Reverse this bookkeeping entry? This does not refund or move money."
                    >
                      <label htmlFor={`reason-${p.id}`}>
                        Correction reason
                      </label>
                      <input
                        id={`reason-${p.id}`}
                        name="reason"
                        required
                        maxLength={1000}
                      />
                    </ActionForm>
                  </details>
                )}
              {s.role === "owner" &&
                s.actor.type !== "support" &&
                p.method === "stripe" &&
                p.amountCents +
                  i.entries
                    .filter((e) => e.reversesPaymentId === p.id)
                    .reduce((n, e) => n + e.amountCents, 0) >
                  0 &&
                !data.refunds.some(
                  (r) =>
                    r.paymentId === p.id &&
                    ["creating", "pending"].includes(r.status),
                ) && (
                  <details>
                    <summary>Refund through Stripe</summary>
                    <StripeRefundForm
                      paymentId={p.id}
                      maxCents={
                        p.amountCents +
                        i.entries
                          .filter((e) => e.reversesPaymentId === p.id)
                          .reduce((n, e) => n + e.amountCents, 0)
                      }
                    />
                  </details>
                )}
            </div>
          ))}
          {data.checkouts.some((c) => c.invoiceId === i.id) && (
            <p role="status">
              An online payment attempt is open or processing. Refresh payment
              status before recording a manual payment or voiding this invoice.
            </p>
          )}
          {s.role === "owner" &&
            s.actor.type !== "support" &&
            data.checkouts
              .filter((c) => c.invoiceId === i.id && c.sessionId)
              .map((c) => (
                <StripeButton key={c.id} kind="cancel" checkoutId={c.id} />
              ))}
          {data.refunds
            .filter((r) => r.invoiceId === i.id)
            .map((r) => (
              <p key={r.id}>
                Refund: {formatMoney(r.amountCents)} · {r.status} · {r.reason}
              </p>
            ))}
          {!i.voidedAt &&
            i.balanceCents > 0 &&
            !data.checkouts.some((c) => c.invoiceId === i.id) &&
            !data.refunds.some(
              (r) =>
                r.invoiceId === i.id &&
                ["creating", "pending"].includes(r.status),
            ) && (
              <InvoicePaymentForm id={i.id} balanceCents={i.balanceCents} />
            )}{" "}
          {s.role === "owner" &&
            !i.voidedAt &&
            i.paidCents === 0 &&
            !data.checkouts.some((c) => c.invoiceId === i.id) && (
              <details>
                <summary>Void invoice</summary>
                <ActionForm
                  action={voidInvoiceAction}
                  hidden={{ id: i.id }}
                  submitLabel="Void invoice"
                  variant="danger"
                  confirm="Void this invoice permanently? Its history remains."
                >
                  <label htmlFor={`void-${i.id}`}>Void reason</label>
                  <input
                    id={`void-${i.id}`}
                    name="reason"
                    required
                    maxLength={1000}
                  />
                </ActionForm>
              </details>
            )}
        </article>
      ))}
    </main>
  );
}
