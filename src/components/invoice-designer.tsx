"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useActionHydration } from "./action-hydration";
import { InvoiceDocument, type InvoiceDocumentData } from "./invoice-document";
import {
  INVOICE_FIELDS,
  INVOICE_PRESETS,
  effectiveDisplay,
  type InvoiceDisplay,
} from "@/lib/invoice-display";
import {
  setInvoiceDisplayAction,
  setInvoiceTemplateAction,
} from "@/server/actions/invoice-display";

const same = (a: InvoiceDisplay, b: InvoiceDisplay) =>
  JSON.stringify(a) === JSON.stringify(b);

// Switches on the left, the customer's exact view below. Starts from this
// invoice's choices, or the owner's default when it has none.
export function InvoiceDesigner({
  invoice,
  invoiceId,
  template,
  override,
  canSaveDefault,
  defaultOnly = false,
  startOpen = false,
}: {
  invoice: InvoiceDocumentData;
  invoiceId?: string;
  template: unknown;
  override: unknown;
  canSaveDefault: boolean;
  defaultOnly?: boolean;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const ready = useActionHydration();
  const router = useRouter();
  const base = useMemo(() => effectiveDisplay(template, null), [template]);
  const [d, setD] = useState<InvoiceDisplay>(() =>
    effectiveDisplay(template, override),
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const groups = [...new Set(INVOICE_FIELDS.map((f) => f.group))];
  const run = async (
    fn: () => Promise<{ ok: boolean; error?: { message: string } }>,
    ok: string,
  ) => {
    setBusy(true);
    try {
      const r = await fn();
      setMessage(r.ok ? ok : (r.error?.message ?? "Could not save."));
      if (r.ok) router.refresh();
    } catch {
      setMessage("Could not save. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  if (!open)
    return (
      <button
        type="button"
        className="btn secondary"
        data-ux-ready={ready}
        onClick={() => setOpen(true)}
      >
        Preview &amp; customize
      </button>
    );
  return (
    <div className="invoice-designer" data-ux-ready={ready}>
      <fieldset className="chips">
        <legend>Start from</legend>
        {INVOICE_PRESETS.map((p) => (
          <label key={p.key}>
            <input
              type="radio"
              name="invoice-preset"
              onChange={() => setD({ ...base, ...p.values })}
            />
            {p.label}
          </label>
        ))}
        <label>
          <input
            type="radio"
            name="invoice-preset"
            onChange={() => setD(base)}
          />
          My default
        </label>
      </fieldset>
      {groups.map((g) => (
        <fieldset key={g}>
          <legend>{g}</legend>
          {INVOICE_FIELDS.filter((f) => f.group === g).map((f) => (
            <label className="switch" key={f.key}>
              <input
                type="checkbox"
                role="switch"
                checked={d[f.key]}
                onChange={(e) => setD({ ...d, [f.key]: e.target.checked })}
              />
              {f.label}
            </label>
          ))}
          {g === "Payment" && d.thankYou && (
            <label>
              Thank-you note
              <input
                maxLength={300}
                value={d.thankYouText}
                onChange={(e) => setD({ ...d, thankYouText: e.target.value })}
              />
            </label>
          )}
        </fieldset>
      ))}
      <h3>Preview: exactly what the customer sees</h3>
      <InvoiceDocument
        invoice={invoice}
        display={d}
        payment={
          d.payOnline ? (
            <p className="muted">[Pay online button appears here]</p>
          ) : null
        }
      />
      <div className="money-actions">
        {!defaultOnly && invoiceId && (
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  setInvoiceDisplayAction({
                    invoiceId,
                    display: d,
                    clientRequestId: crypto.randomUUID(),
                  }),
                "Saved for this invoice. The customer’s link shows it now.",
              )
            }
          >
            Save for this invoice
          </button>
        )}
        {canSaveDefault && (
          <button
            type="button"
            className={`btn ${defaultOnly ? "primary" : "secondary"}`}
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  setInvoiceTemplateAction({
                    display: d,
                    clientRequestId: crypto.randomUUID(),
                  }),
                "Saved as your default. New invoices start this way.",
              )
            }
          >
            Save as my default
          </button>
        )}
        {!defaultOnly && invoiceId && !same(d, base) && (
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={async () => {
              setD(base);
              await run(
                () =>
                  setInvoiceDisplayAction({
                    invoiceId,
                    display: null,
                    clientRequestId: crypto.randomUUID(),
                  }),
                "Back to your default.",
              );
            }}
          >
            Reset to my default
          </button>
        )}
        <button
          type="button"
          className="btn secondary"
          onClick={() => window.print()}
        >
          Print
        </button>
      </div>
      <p role="status">{message}</p>
    </div>
  );
}
