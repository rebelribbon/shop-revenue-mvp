import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { formatMoney } from "@/components/estimate-document";
import { HydratedMain } from "@/components/hydrated-main";
import { QuickSale } from "@/components/quick-sale";
import { withTenant } from "@/db/tenant";
import { getCounterSale, quickSaleSettings } from "@/domain/counter-sales";
import { partCatalog } from "@/domain/parts";
import { METHOD_LABELS } from "@/domain/register";
import { voidCounterSaleAction } from "@/server/actions/counter-sales";
import { requireShopSession } from "@/server/views/shop";

export default async function QuickSalePage(props: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await props.searchParams;
  const s = await requireShopSession("/app/checkout/sale");
  const data = await withTenant(s.businessId, s.actor, async (tx) => ({
    sale: id ? await getCounterSale(tx, id) : null,
    settings: await quickSaleSettings(tx),
    catalog: id ? [] : await partCatalog(tx),
  }));
  const sale = data.sale;

  if (sale)
    return (
      <HydratedMain id="main-content" tabIndex={-1}>
        <p>
          <Link href="/app/checkout/sale">← New quick sale</Link>
        </p>
        <h1>Sale #{sale.number}</h1>
        <p className="muted">
          {sale.createdAt.toLocaleString("en-US", {
            timeZone: data.settings.timezone,
            dateStyle: "medium",
            timeStyle: "short",
          })}{" "}
          · {METHOD_LABELS[sale.method] ?? sale.method}
          {sale.reference && ` · ${sale.reference}`}
        </p>
        {sale.voidedAt && (
          <p className="notice" role="status">
            Voided: {sale.voidReason}
          </p>
        )}
        <section className="card" aria-label="Receipt">
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
                {sale.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.description}</td>
                    <td>{l.quantityHundredths / 100}</td>
                    <td>{formatMoney(l.unitPriceCents)}</td>
                    <td>
                      {formatMoney(
                        Math.round(
                          (l.quantityHundredths * l.unitPriceCents) / 100,
                        ),
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="checkout-totals">
            <dt>Subtotal</dt>
            <dd>{formatMoney(sale.subtotalCents)}</dd>
            {sale.taxCents > 0 && (
              <>
                <dt>Sales tax ({sale.taxBps / 100}%)</dt>
                <dd>{formatMoney(sale.taxCents)}</dd>
              </>
            )}
            <dt>Total</dt>
            <dd className="checkout-due">{formatMoney(sale.totalCents)}</dd>
            {sale.receivedCents !== null && (
              <>
                <dt>Cash received · change</dt>
                <dd>
                  {formatMoney(sale.receivedCents)} ·{" "}
                  {formatMoney(sale.receivedCents - sale.totalCents)}
                </dd>
              </>
            )}
          </dl>
        </section>
        <p>
          <Link className="btn primary" href="/app/checkout/sale">
            New sale
          </Link>
        </p>
        {sale.canVoid && s.actor.type !== "support" && (
          <details className="sale-void">
            <summary>Void this sale</summary>
            <ActionForm
              action={voidCounterSaleAction}
              hidden={{ id: sale.id }}
              submitLabel="Void sale"
              variant="danger"
              confirm="Void this sale? Parts go back on the shelf."
            >
              <label htmlFor="void-reason">Why?</label>
              <input id="void-reason" name="reason" required maxLength={500} />
            </ActionForm>
          </details>
        )}
      </HydratedMain>
    );

  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <p>
        <Link href="/app/checkout">← Checkout</Link>
      </p>
      <h1>Quick sale</h1>
      <p className="muted">
        Sell parts or items over the counter, no job needed. Parts come off the
        shelf.
      </p>
      {s.actor.type === "support" ? (
        <p className="muted">Support view is read-only.</p>
      ) : (
        <QuickSale
          catalog={data.catalog}
          taxRateBps={data.settings.taxRateBps}
          taxDefault={data.settings.partsTaxable}
        />
      )}
    </HydratedMain>
  );
}
