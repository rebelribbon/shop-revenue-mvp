// Internal numbers for an RO: what each line costs the shop, what it sells
// for, and the profit. Staff only; the customer view hides this.
import type { JobProfit } from "@/domain/job-profit";

const money = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    c / 100,
  );
const pct = (profit: number, price: number) =>
  price > 0 ? `${Math.round((profit * 100) / price)}%` : "—";
const basis = {
  clocked: "clocked time",
  actual: "actual hours",
  quoted: "quoted hours",
} as const;

export function RoCosts({ profit: p }: { profit: JobProfit }) {
  if (!p.lines.length)
    return (
      <p className="muted">
        Add parts and labor in Set up job to see costs and profit.
      </p>
    );
  return (
    <div className="ro-costs" data-ro-costs>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Qty / hours</th>
              <th scope="col" className="num">
                Cost
              </th>
              <th scope="col" className="num">
                Price
              </th>
              <th scope="col" className="num">
                Profit
              </th>
              <th scope="col" className="num">
                Margin
              </th>
            </tr>
          </thead>
          <tbody>
            {p.lines.map((l, i) => (
              <tr key={i}>
                <th scope="row">
                  {l.description}
                  <span className="muted">
                    {" "}
                    · {l.kind === "part" ? "Part" : "Labor"}
                  </span>
                </th>
                <td>{l.quantity}</td>
                <td className="num">
                  {l.costCents === null ? (
                    <span className="muted">No cost</span>
                  ) : (
                    money(l.costCents)
                  )}
                </td>
                <td className="num">{money(l.priceCents)}</td>
                <td className="num">
                  {l.costCents === null
                    ? "—"
                    : money(l.priceCents - l.costCents)}
                </td>
                <td className="num">
                  {l.costCents === null
                    ? "—"
                    : pct(l.priceCents - l.costCents, l.priceCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ro-costs-totals">
        <div>
          <dt>Parts cost</dt>
          <dd>
            {p.partsCostCents === null ? "Missing" : money(p.partsCostCents)}
          </dd>
        </div>
        <div>
          <dt>Labor cost ({basis[p.laborBasis]})</dt>
          <dd>
            {p.laborCostCents === null ? "Missing" : money(p.laborCostCents)}
          </dd>
        </div>
        {p.cardFeesCents > 0 && (
          <div>
            <dt>Card fees</dt>
            <dd>{money(p.cardFeesCents)}</dd>
          </div>
        )}
        <div>
          <dt>Total cost</dt>
          <dd>{p.costCents === null ? "Missing" : money(p.costCents)}</dd>
        </div>
        <div>
          <dt>Sales before tax</dt>
          <dd>{money(p.salesCents)}</dd>
        </div>
        <div className={p.belowTarget ? "is-low" : "is-good"}>
          <dt>Profit</dt>
          <dd>
            {p.profitCents === null ? (
              <span className="muted">Unknown: {p.missing.join(", ")}</span>
            ) : (
              <>
                <strong>{money(p.profitCents)}</strong> ·{" "}
                {((p.marginBps ?? 0) / 100).toFixed(0)}% margin
                {p.belowTarget &&
                  ` (target ${(p.targetBps / 100).toFixed(0)}%)`}
              </>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
