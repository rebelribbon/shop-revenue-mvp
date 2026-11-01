import type { EstimateSnapshot } from "@/db/schema/m3";
import { estimateTotals } from "@/lib/estimate-tax";
export const formatMoney = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    c / 100,
  );
export function EstimateDocument({
  snapshot: s,
}: {
  snapshot: EstimateSnapshot;
}) {
  return (
    <section className="card">
      <h2>{s.title}</h2>
      <p>
        <strong>{s.shopName}</strong>
      </p>
      <p>
        {s.customerName} · {s.serviceLabel || s.vehicleLabel}
      </p>
      <ul>
        {s.lines.map((l) => (
          <li key={l.id}>
            {l.description} — {l.quantity}{" "}
            {l.kind === "labor"
              ? l.quantity === 1
                ? "hour"
                : "hours"
              : l.quantity === 1
                ? "unit"
                : "units"}{" "}
            × {formatMoney(l.unitPriceCents)} ={" "}
            <strong>{formatMoney(l.totalCents)}</strong>
            {l.taxable === false
              ? " · Not taxable"
              : l.taxable === true
                ? " · Taxable"
                : ""}
          </li>
        ))}
      </ul>
      <p>
        Subtotal: {formatMoney(s.subtotalCents)} · Tax:{" "}
        {formatMoney(s.taxCents)}
      </p>
      <p>
        <strong>Estimate total: {formatMoney(s.totalCents)}</strong>
      </p>
      {s.terms && <p style={{ whiteSpace: "pre-wrap" }}>{s.terms}</p>}
    </section>
  );
}

export function AuthorizedTotal({
  snapshot: s,
  ids,
}: {
  snapshot: EstimateSnapshot;
  ids: string[];
}) {
  const totals = estimateTotals(
    s.lines.filter((l) => ids.includes(l.id)),
    s.taxBps,
  );
  return (
    <p>
      <strong>
        Authorized total including tax: {formatMoney(totals.totalCents)}
      </strong>
    </p>
  );
}
