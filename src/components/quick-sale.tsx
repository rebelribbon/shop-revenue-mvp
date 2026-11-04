"use client";
import Link from "next/link";
import { useState } from "react";
import type { CatalogPart } from "@/domain/parts";
import { createCounterSaleAction } from "@/server/actions/counter-sales";
import { useActionHydration } from "./action-hydration";

const fmt = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    c / 100,
  );
const toCents = (v: string) => Math.round(Number(v || 0) * 100);

type Line = {
  key: string;
  partItemId?: string;
  description: string;
  qty: string;
  price: string;
};
type Method = "external_card" | "cash" | "check";

const lineCents = (l: Line) =>
  Math.round(Number(l.qty || 0) * toCents(l.price));

function cashChoices(due: number) {
  const out = new Set<number>([due]);
  for (const step of [500, 1000, 2000, 5000, 10000])
    out.add(Math.ceil(due / step) * step);
  return [...out].sort((a, b) => a - b).slice(0, 5);
}

export function QuickSale({
  catalog,
  taxRateBps,
  taxDefault,
}: {
  catalog: CatalogPart[];
  taxRateBps: number;
  taxDefault: boolean;
}) {
  const ready = useActionHydration();
  const [lines, setLines] = useState<Line[]>([]);
  const [chargeTax, setChargeTax] = useState(taxDefault && taxRateBps > 0);
  const [method, setMethod] = useState<Method>("external_card");
  const [received, setReceived] = useState("");
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [done, setDone] = useState<{
    id: string;
    number: number;
    total: number;
    change: number;
  } | null>(null);

  const subtotal = lines.reduce((t, l) => t + lineCents(l), 0);
  const tax = chargeTax ? Math.round((subtotal * taxRateBps) / 10000) : 0;
  const total = subtotal + tax;
  const short =
    method === "cash" && received !== "" && toCents(received) < total;
  const update = (key: string, patch: Partial<Line>) =>
    setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  if (done)
    return (
      <section className="checkout-pay" aria-live="polite">
        <p className="checkout-label">Sale #{done.number}</p>
        <strong className="checkout-amount">{fmt(done.total)}</strong>
        {done.change > 0 && (
          <p className="checkout-change">Give back {fmt(done.change)} change</p>
        )}
        <div className="checkout-after">
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              setDone(null);
              setLines([]);
              setReceived("");
              setReference("");
              setRequestId(crypto.randomUUID());
            }}
          >
            New sale
          </button>
          <Link
            className="btn secondary"
            href={`/app/checkout/sale?id=${done.id}`}
          >
            Receipt
          </Link>
        </div>
      </section>
    );

  return (
    <form
      className="quick-sale"
      data-ux-ready={ready}
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending || total <= 0 || short) return;
        setPending(true);
        setMessage("");
        try {
          const r = await createCounterSaleAction({
            lines: lines.map((l) =>
              l.partItemId
                ? {
                    partItemId: l.partItemId,
                    quantityHundredths: Math.round(Number(l.qty) * 100),
                  }
                : {
                    description: l.description,
                    quantityHundredths: Math.round(Number(l.qty) * 100),
                    unitPriceCents: toCents(l.price),
                  },
            ),
            chargeTax,
            method,
            reference,
            receivedCents:
              method === "cash" && received !== "" ? toCents(received) : null,
            clientRequestId: requestId,
          });
          if (r.ok) {
            const d = r.data as {
              id: string;
              number: number;
              totalCents: number;
              changeCents: number;
            };
            setDone({
              id: d.id,
              number: d.number,
              total: d.totalCents,
              change: d.changeCents,
            });
          } else setMessage(r.error.message);
        } catch {
          setMessage("Couldn’t record the sale. Try again.");
        } finally {
          setPending(false);
        }
      }}
    >
      <section className="card" aria-label="Items">
        <h2>What are they buying?</h2>
        {catalog.length > 0 && (
          <>
            <label htmlFor="sale-part">Add a part from your list</label>
            <select
              id="sale-part"
              value=""
              onChange={(e) => {
                const p = catalog.find((c) => c.id === e.target.value);
                if (!p) return;
                const existing = lines.find((l) => l.partItemId === p.id);
                if (existing)
                  update(existing.key, {
                    qty: String(Number(existing.qty || 0) + 1),
                  });
                else
                  setLines([
                    ...lines,
                    {
                      key: crypto.randomUUID(),
                      partItemId: p.id,
                      description: p.name,
                      qty: "1",
                      price: (p.unitPriceCents / 100).toFixed(2),
                    },
                  ]);
              }}
            >
              <option value="">Pick a part…</option>
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {fmt(c.unitPriceCents)} ·{" "}
                  {c.onHandHundredths / 100} on hand
                </option>
              ))}
            </select>
          </>
        )}
        <button
          type="button"
          className="btn secondary"
          onClick={() =>
            setLines([
              ...lines,
              {
                key: crypto.randomUUID(),
                description: "",
                qty: "1",
                price: "",
              },
            ])
          }
        >
          + Other item
        </button>
        {lines.length > 0 && (
          <ul className="sale-lines">
            {lines.map((l, i) => (
              <li key={l.key}>
                {l.partItemId ? (
                  <strong>{l.description}</strong>
                ) : (
                  <>
                    <label htmlFor={`sale-desc-${i}`}>Item</label>
                    <input
                      id={`sale-desc-${i}`}
                      required
                      maxLength={200}
                      value={l.description}
                      onChange={(e) =>
                        update(l.key, { description: e.target.value })
                      }
                    />
                    <label htmlFor={`sale-price-${i}`}>Price each</label>
                    <input
                      id={`sale-price-${i}`}
                      required
                      inputMode="decimal"
                      value={l.price}
                      onChange={(e) =>
                        update(l.key, {
                          price: e.target.value.replace(/[^\d.]/g, ""),
                        })
                      }
                    />
                  </>
                )}
                <label htmlFor={`sale-qty-${i}`}>How many</label>
                <input
                  id={`sale-qty-${i}`}
                  inputMode="decimal"
                  required
                  value={l.qty}
                  onChange={(e) =>
                    update(l.key, {
                      qty: e.target.value.replace(/[^\d.]/g, ""),
                    })
                  }
                />
                <p className="sale-line-total">
                  <span>{fmt(lineCents(l))}</span>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() =>
                      setLines(lines.filter((x) => x.key !== l.key))
                    }
                  >
                    Remove
                  </button>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="checkout-pay" aria-label="Take payment">
        <p className="checkout-label">Total</p>
        <strong className="checkout-amount">{fmt(total)}</strong>
        {taxRateBps > 0 && (
          <label className="sale-tax">
            <input
              type="checkbox"
              checked={chargeTax}
              onChange={(e) => setChargeTax(e.target.checked)}
            />
            Charge sales tax ({taxRateBps / 100}%){" "}
            {chargeTax && <span className="muted">· {fmt(tax)}</span>}
          </label>
        )}
        <fieldset className="checkout-methods">
          <legend>How are they paying?</legend>
          {(
            [
              ["external_card", "Card", "On your card terminal"],
              ["cash", "Cash", "Shows the change due"],
              ["check", "Check", "Add the check number"],
            ] as const
          ).map(([key, label, hint]) => (
            <label key={key} className="checkout-method">
              <input
                type="radio"
                name="sale-method"
                checked={method === key}
                onChange={() => setMethod(key)}
              />
              <span>
                <strong>{label}</strong>
                <span>{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {method === "cash" ? (
          <>
            {total > 0 && (
              <div
                className="checkout-quick"
                role="group"
                aria-label="Cash received"
              >
                {cashChoices(total).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="btn secondary"
                    aria-pressed={toCents(received) === c}
                    onClick={() => setReceived((c / 100).toFixed(2))}
                  >
                    {fmt(c)}
                  </button>
                ))}
              </div>
            )}
            <label htmlFor="sale-received">Cash received</label>
            <input
              id="sale-received"
              inputMode="decimal"
              value={received}
              onChange={(e) =>
                setReceived(e.target.value.replace(/[^\d.]/g, ""))
              }
            />
            {received !== "" && (
              <p className={short ? "checkout-short" : "checkout-change"}>
                {short
                  ? `That’s ${fmt(total - toCents(received))} short.`
                  : `Change due: ${fmt(toCents(received) - total)}`}
              </p>
            )}
          </>
        ) : (
          <>
            <label htmlFor="sale-ref">
              {method === "check"
                ? "Check number"
                : "Last 4 of the card (optional)"}
            </label>
            <input
              id="sale-ref"
              maxLength={100}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </>
        )}
        <button
          className="btn primary"
          disabled={!ready || pending || total <= 0 || short}
        >
          {pending ? "Recording…" : `Take ${fmt(total)}`}
        </button>
        <p role="status">{message}</p>
      </section>
    </form>
  );
}
