"use client";
import { useActionHydration } from "./action-hydration";
import Link from "next/link";
import { DocumentShare } from "./document-share";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  issueInvoiceAction,
  recordInvoicePaymentAction,
  rotateInvoiceLinkAction,
} from "@/server/actions/invoices";
export function InvoiceIssuer({
  choices,
  initialVersionId,
  today,
}: {
  choices: { id: string; label: string; jobId: string }[];
  initialVersionId?: string;
  today: string;
}) {
  const ready = useActionHydration();
  const router = useRouter();
  const [issuedId, setIssuedId] = useState("");
  const [share, setShare] = useState<
    | { path: string; name: string; phone: string | null; email: string | null }
    | undefined
  >();
  const [issuedJobId, setIssuedJobId] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [dueMode, setDueMode] = useState("receipt");
  const [dueOn, setDueOn] = useState(today);
  if (issuedId)
    return (
      <section className="card" data-ux-ready={ready}>
        <h2>Invoice ready</h2>
        <DocumentShare id={issuedId} kind="invoice" primary initial={share} />
        <p role="status">
          Invoice issued. No payment was collected by creating this invoice.
        </p>
        <p>
          Share the customer link yourself. Work progress, authorization and
          money stay linked to the job timeline.
        </p>
        <Link
          className="btn primary"
          data-page-primary
          href={`/app/invoices?invoiceId=${issuedId}`}
        >
          Open invoice &amp; record payment
        </Link>
        {issuedJobId && (
          <Link className="btn secondary" href={`/app/jobs?job=${issuedJobId}`}>
            Job timeline &amp; authorized work
          </Link>
        )}
      </section>
    );
  if (!choices.length)
    return (
      <section className="card" data-ux-ready={ready}>
        <h2>No authorized work ready to invoice</h2>
        <p>
          Review the latest customer decision first. Each job can have one
          active invoice.
        </p>
        <Link className="btn primary" href="/app/estimates">
          Review estimates
        </Link>
      </section>
    );
  return (
    <form
      data-ux-ready={ready}
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const versionId = String(f.get("versionId") ?? "");
        setPending(true);
        try {
          const result = await issueInvoiceAction({
            versionId,
            dueOn: dueMode === "date" ? dueOn : "",
            terms:
              dueMode === "receipt"
                ? ["Due on receipt.", String(f.get("terms") ?? "")]
                    .filter(Boolean)
                    .join("\n\n")
                : String(f.get("terms") ?? ""),
            clientRequestId: requestId,
          });
          if (result.ok) {
            setIssuedId((result.data as { id: string }).id);
            setShare((result.data as { share?: typeof share }).share);
            setIssuedJobId(
              choices.find((c) => c.id === versionId)?.jobId ?? "",
            );
            setRequestId(crypto.randomUUID());
            router.refresh();
          } else setMessage(result.error.message);
        } catch {
          setMessage("Unable to issue invoice. Your entries were kept.");
        } finally {
          setPending(false);
        }
      }}
    >
      <h2>Create invoice</h2>
      <p>
        This bills authorized work. It does not mark work complete, send a
        message or charge a card.
      </p>
      <label htmlFor="invoice-estimate">Authorized estimate</label>
      <select
        id="invoice-estimate"
        name="versionId"
        required
        defaultValue={initialVersionId ?? ""}
      >
        <option value="">Choose approved estimate</option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <label htmlFor="invoice-due-mode">Payment due</label>
      <select
        id="invoice-due-mode"
        value={dueMode}
        onChange={(e) => setDueMode(e.target.value)}
      >
        <option value="receipt">Due on receipt</option>
        <option value="date">Choose a due date</option>
      </select>
      {dueMode === "date" && (
        <>
          <label htmlFor="dueOn">Due date</label>
          <input
            id="dueOn"
            name="dueOn"
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            required
          />
          <p className="muted">
            Calendar date in the shop’s timezone. This will not shift when the
            customer opens the invoice.
          </p>
        </>
      )}
      <label htmlFor="invoiceTerms">Invoice terms</label>
      <textarea
        id="invoiceTerms"
        name="terms"
        maxLength={dueMode === "receipt" ? 4980 : 5000}
      />
      <button className="btn primary" disabled={pending}>
        {pending ? "Preparing…" : "Create invoice"}
      </button>
      <p role="status">{message}</p>
    </form>
  );
}
function ShareLink({ path }: { path: string }) {
  return (
    <p>
      <a href={path} target="_blank" rel="noreferrer">
        Open customer invoice
      </a>
      <label>
        Customer invoice link
        <input
          readOnly
          value={`${window.location.origin}${path}`}
          onFocus={(e) => e.currentTarget.select()}
        />
      </label>
    </p>
  );
}
export function InvoiceLink({ id }: { id: string }) {
  const ready = useActionHydration();
  const [path, setPath] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <div data-ux-ready={ready}>
      <DocumentShare id={id} kind="invoice" />
      <details>
        <summary>Older link options</summary>
        <button
          className="btn secondary"
          disabled={pending}
          onClick={async () => {
            if (
              !window.confirm(
                "Replace this link? The previous customer link will stop working.",
              )
            )
              return;
            setPending(true);
            try {
              const r = await rotateInvoiceLinkAction({
                id,
                clientRequestId: crypto.randomUUID(),
              });
              if (r.ok) {
                setPath((r.data as { path?: string }).path ?? "");
                setMessage(
                  "Replacement link created. Previous link is no longer active.",
                );
              } else setMessage(r.error.message);
            } catch {
              setMessage("Unable to create link. Please try again.");
            } finally {
              setPending(false);
            }
          }}
        >
          Replace older link
        </button>
        <p className="muted">
          Replacing the link disables the previous customer link.
        </p>
        <p role="status">{message}</p>
        {path && <ShareLink path={path} />}
      </details>
    </div>
  );
}
export function InvoicePaymentForm({
  id,
  balanceCents,
}: {
  id: string;
  balanceCents: number;
}) {
  const ready = useActionHydration();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  return (
    <form
      data-ux-ready={ready}
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setPending(true);
        try {
          const r = await recordInvoicePaymentAction({
            invoiceId: id,
            amountCents: Math.round(Number(f.get("amount")) * 100),
            method: f.get("method"),
            reference: f.get("reference"),
            clientRequestId: requestId,
          });
          if (r.ok) {
            setMessage("Payment recorded.");
            setRequestId(crypto.randomUUID());
            router.refresh();
          } else setMessage(r.error.message);
        } catch {
          setMessage("Unable to record payment. Please try again.");
        } finally {
          setPending(false);
        }
      }}
    >
      <h3>Record payment received</h3>
      <p className="muted">Enter a payment you already received.</p>
      <label htmlFor={`payment-${id}`}>Amount ($)</label>
      <input
        id={`payment-${id}`}
        name="amount"
        type="number"
        step="0.01"
        min="0.01"
        max={balanceCents / 100}
        key={balanceCents}
        defaultValue={(balanceCents / 100).toFixed(2)}
        required
      />
      <label htmlFor={`method-${id}`}>Payment method</label>
      <select id={`method-${id}`} name="method" defaultValue="cash">
        <option value="cash">Cash</option>
        <option value="check">Check</option>
        <option value="bank_transfer">Bank transfer</option>
        <option value="external_card">
          Card paid through another processor
        </option>
      </select>
      <label htmlFor={`reference-${id}`}>Receipt / check reference</label>
      <input id={`reference-${id}`} name="reference" maxLength={500} />
      <button className="btn primary" disabled={pending}>
        {pending ? "Recording…" : "Record payment"}
      </button>
      <p role="status">{message}</p>
    </form>
  );
}
export function PrintDocument({ label }: { label: string }) {
  const ready = useActionHydration();
  return (
    <button
      data-ux-ready={ready}
      className="btn secondary"
      onClick={() => window.print()}
    >
      {label}
    </button>
  );
}
export function PrintInvoice() {
  const ready = useActionHydration();
  return (
    <button
      data-ux-ready={ready}
      className="btn secondary"
      onClick={() => window.print()}
    >
      Print invoice / Save PDF
    </button>
  );
}
