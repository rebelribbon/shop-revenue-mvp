"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useActionHydration } from "./action-hydration";
import { recordInvoicePaymentAction } from "@/server/actions/invoices";
import { DocumentShare } from "./document-share";

const fmt = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    c / 100,
  );
const toCents = (v: string) => Math.round(Number(v || 0) * 100);

type Method = "cash" | "external_card" | "check" | "link";
const METHODS: { key: Method; label: string; hint: string }[] = [
  { key: "external_card", label: "Card", hint: "On your card terminal" },
  { key: "cash", label: "Cash", hint: "Shows the change due" },
  { key: "check", label: "Check", hint: "Add the check number" },
  { key: "link", label: "Text a pay link", hint: "They pay on their phone" },
];

// Quick cash amounts: the exact due, then the next round bills up.
function cashChoices(due: number) {
  const out = new Set<number>([due]);
  for (const step of [500, 1000, 2000, 5000, 10000])
    out.add(Math.ceil(due / step) * step);
  return [...out].sort((a, b) => a - b).slice(0, 5);
}

export function CheckoutPanel({
  invoiceId,
  dueCents,
}: {
  invoiceId: string;
  dueCents: number;
}) {
  const ready = useActionHydration();
  const router = useRouter();
  const [method, setMethod] = useState<Method>("external_card");
  const [amount, setAmount] = useState((dueCents / 100).toFixed(2));
  const [received, setReceived] = useState("");
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [done, setDone] = useState<{ paid: number; change: number } | null>(
    null,
  );
  const charge = Math.min(toCents(amount), dueCents);
  const change =
    method === "cash" && received ? Math.max(0, toCents(received) - charge) : 0;
  const short =
    method === "cash" && received !== "" && toCents(received) < charge;

  if (done)
    return (
      <section className="checkout-pay" aria-live="polite">
        <p className="checkout-label">Payment taken</p>
        <strong className="checkout-amount">{fmt(done.paid)}</strong>
        {done.change > 0 && (
          <p className="checkout-change">Give back {fmt(done.change)} change</p>
        )}
        <p>
          {dueCents - done.paid > 0
            ? `${fmt(dueCents - done.paid)} is still due on this invoice.`
            : "Paid in full."}
        </p>
        <div className="checkout-after">
          {dueCents - done.paid > 0 ? (
            <button
              className="btn primary"
              type="button"
              onClick={() => {
                setDone(null);
                setRequestId(crypto.randomUUID());
                router.refresh();
              }}
            >
              Take the rest
            </button>
          ) : (
            <Link className="btn primary" href="/app/checkout">
              Next checkout
            </Link>
          )}
          <Link
            className="btn secondary"
            href={`/app/invoices?invoiceId=${invoiceId}`}
          >
            Print or send receipt
          </Link>
        </div>
      </section>
    );

  return (
    <section
      className="checkout-pay"
      aria-label="Take payment"
      data-ux-ready={ready}
    >
      <p className="checkout-label">Due now</p>
      <strong className="checkout-amount">{fmt(dueCents)}</strong>
      <fieldset className="checkout-methods">
        <legend>How are they paying?</legend>
        {METHODS.map((m) => (
          <label key={m.key} className="checkout-method">
            <input
              type="radio"
              name="pay-method"
              checked={method === m.key}
              onChange={() => setMethod(m.key)}
            />
            <span>
              <strong>{m.label}</strong>
              <span>{m.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {method === "link" ? (
        <div className="checkout-link">
          <p>
            Send this link by text or email. When they pay, it shows up here and
            on the invoice automatically.
          </p>
          <DocumentShare id={invoiceId} kind="invoice" />
        </div>
      ) : (
        <form
          className="checkout-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (pending || charge <= 0 || short) return;
            setPending(true);
            setMessage("");
            try {
              const r = await recordInvoicePaymentAction({
                invoiceId,
                amountCents: charge,
                method,
                reference:
                  method === "cash" && received
                    ? `Received ${fmt(toCents(received))}`
                    : reference,
                clientRequestId: requestId,
              });
              if (r.ok) {
                setDone({ paid: charge, change });
                router.refresh();
              } else setMessage(r.error.message);
            } catch {
              setMessage("Couldn’t record the payment. Try again.");
            } finally {
              setPending(false);
            }
          }}
        >
          <label htmlFor="checkout-amount">
            Amount to take{" "}
            <span className="muted">(less than due = split payment)</span>
          </label>
          <input
            id="checkout-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          />
          {method === "cash" && (
            <>
              <span className="checkout-sub">Cash received</span>
              <div
                className="checkout-quick"
                role="group"
                aria-label="Cash received"
              >
                {cashChoices(charge).map((c) => (
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
              <label htmlFor="checkout-received">Other amount received</label>
              <input
                id="checkout-received"
                inputMode="decimal"
                value={received}
                onChange={(e) =>
                  setReceived(e.target.value.replace(/[^\d.]/g, ""))
                }
              />
              {received !== "" && (
                <p className={short ? "checkout-short" : "checkout-change"}>
                  {short
                    ? `That’s ${fmt(charge - toCents(received))} short.`
                    : `Change due: ${fmt(change)}`}
                </p>
              )}
            </>
          )}
          {method !== "cash" && (
            <>
              <label htmlFor="checkout-reference">
                {method === "check"
                  ? "Check number"
                  : "Last 4 of the card (optional)"}
              </label>
              <input
                id="checkout-reference"
                value={reference}
                maxLength={100}
                onChange={(e) => setReference(e.target.value)}
              />
            </>
          )}
          <button
            className="btn primary"
            disabled={!ready || pending || charge <= 0 || short}
          >
            {pending ? "Recording…" : `Take ${fmt(charge)}`}
          </button>
          <p role="status">{message}</p>
        </form>
      )}
    </section>
  );
}
