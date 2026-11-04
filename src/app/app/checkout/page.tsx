import Link from "next/link";
import { CheckoutPanel } from "@/components/checkout-panel";
import { formatMoney } from "@/components/estimate-document";
import { HydratedMain } from "@/components/hydrated-main";
import { withTenant } from "@/db/tenant";
import { listInvoices } from "@/domain/invoices";
import { loadPipeline } from "@/domain/pipeline";
import { readReviewSettings } from "@/domain/review-requests";
import { requireShopSession } from "@/server/views/shop";

// Checkout: pick who's paying, see the bill, take the money.
export default async function CheckoutPage(props: {
  searchParams: Promise<{ invoiceId?: string }>;
}) {
  const { invoiceId } = await props.searchParams;
  const s = await requireShopSession("/app/checkout");
  const readOnly = s.actor.type === "support";
  const [invoices, pipe, reviews] = await withTenant(
    s.businessId,
    s.actor,
    (tx) =>
      Promise.all([
        listInvoices(tx, invoiceId),
        invoiceId ? null : loadPipeline(tx),
        readReviewSettings(tx),
      ]),
  );

  if (invoiceId) {
    const i = invoices[0];
    if (!i)
      return (
        <HydratedMain id="main-content" tabIndex={-1}>
          <h1>Checkout</h1>
          <p>That invoice wasn’t found.</p>
          <Link className="btn primary" data-page-primary href="/app/checkout">
            Back to checkout
          </Link>
        </HydratedMain>
      );
    const snap = i.snapshot;
    return (
      <HydratedMain id="main-content" tabIndex={-1}>
        <p>
          <Link href="/app/checkout">← Checkout</Link>
        </p>
        <div className="checkout-layout">
          <section className="card checkout-ticket" aria-label="Bill">
            <header className="checkout-who">
              <div>
                <h1>
                  <Link href={`/app/customers/${i.customerId}`}>
                    {snap.customerName}
                  </Link>
                </h1>
                <p className="muted">
                  {[
                    snap.serviceLabel || snap.vehicleLabel,
                    snap.title,
                    `Invoice #${i.number}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {i.voidedAt && <span className="pill pill-muted">Voided</span>}
            </header>
            <div className="table-wrap">
              <table className="checkout-lines">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Price</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.description}</td>
                      <td>{l.quantity}</td>
                      <td>{formatMoney(l.unitPriceCents)}</td>
                      <td>{formatMoney(l.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="checkout-totals">
              <dt>Subtotal</dt>
              <dd>{formatMoney(snap.subtotalCents)}</dd>
              <dt>Sales tax</dt>
              <dd>{formatMoney(snap.taxCents)}</dd>
              <dt>Total</dt>
              <dd>{formatMoney(i.totalCents)}</dd>
              {i.paidCents !== 0 && (
                <>
                  <dt>Paid so far</dt>
                  <dd>− {formatMoney(i.paidCents)}</dd>
                </>
              )}
              <dt className="checkout-due">Due now</dt>
              <dd className="checkout-due">
                {formatMoney(Math.max(0, i.balanceCents))}
              </dd>
            </dl>
            {i.entries.length > 0 && (
              <ul className="row-list checkout-paid">
                {i.entries.map((p) => (
                  <li key={p.id}>
                    <div>
                      <span className="row-main">
                        <strong>{formatMoney(p.amountCents)}</strong>
                        <span className="muted">
                          {p.method.replaceAll("_", " ")}
                          {p.reference ? ` · ${p.reference}` : ""}
                        </span>
                      </span>
                      <span className="row-side muted">
                        {p.createdAt.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <div className="checkout-side">
            {i.voidedAt ? (
              <p className="notice">This invoice was voided.</p>
            ) : i.balanceCents <= 0 ? (
              <section className="checkout-pay">
                <p className="checkout-label">All set</p>
                <strong className="checkout-amount">Paid in full</strong>
                <div className="checkout-after">
                  <Link
                    className="btn primary"
                    data-page-primary
                    href="/app/checkout"
                  >
                    Next checkout
                  </Link>
                  <Link
                    className="btn secondary"
                    href={`/app/invoices?invoiceId=${i.id}`}
                  >
                    Print or send receipt
                  </Link>
                </div>
              </section>
            ) : readOnly ? (
              <p className="muted">Support view is read-only.</p>
            ) : (
              <CheckoutPanel
                invoiceId={i.id}
                dueCents={i.balanceCents}
                canAskReview={!!reviews.link}
              />
            )}
          </div>
        </div>
      </HydratedMain>
    );
  }

  const owed = invoices
    .filter((i) => !i.voidedAt && i.balanceCents > 0)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const ready = pipe?.columns.invoice ?? [];
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Checkout</h1>
      <p className="muted">
        Pick who’s paying, or{" "}
        <Link href="/app/checkout/sale">ring up a quick sale</Link> with no job.
      </p>
      {owed[0] ? (
        <Link
          className="btn primary"
          data-page-primary
          href={`/app/checkout?invoiceId=${owed[0].id}`}
        >
          Check out {owed[0].snapshot.customerName} ·{" "}
          {formatMoney(owed[0].balanceCents)}
        </Link>
      ) : (
        <Link
          className="btn primary"
          data-page-primary
          href="/app/jobs?view=board"
        >
          See the jobs board
        </Link>
      )}
      <h2>Waiting to pay</h2>
      {owed.length === 0 ? (
        <p className="muted">No open invoices.</p>
      ) : (
        <ul className="row-list card" aria-label="Waiting to pay">
          {owed.map((i) => (
            <li key={i.id}>
              <Link
                href={`/app/checkout?invoiceId=${i.id}`}
                aria-label={`Check out ${i.snapshot.customerName}`}
              >
                <span className="row-main">
                  <strong>{i.snapshot.customerName}</strong>
                  <span className="muted">
                    {[i.snapshot.title, `Invoice #${i.number}`].join(" · ")}
                  </span>
                </span>
                <span className="row-side">
                  <strong>{formatMoney(i.balanceCents)}</strong>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <h2>Finished, not billed yet</h2>
      {ready.length === 0 ? (
        <p className="muted">Nothing waiting to be billed.</p>
      ) : (
        <ul className="row-list card" aria-label="Finished, not billed yet">
          {ready.map((c) => (
            <li key={c.id}>
              <Link
                href={
                  c.versionId
                    ? `/app/invoices?new=1&versionId=${c.versionId}`
                    : `/app/jobs?job=${c.id}`
                }
              >
                <span className="row-main">
                  <strong>{c.customerName}</strong>
                  <span className="muted">{c.title} · create the invoice</span>
                </span>
                <span className="row-side">{formatMoney(c.amountCents)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </HydratedMain>
  );
}
