"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./desktop-demo.module.css";
import { eligibleInvoiceLines, invoiceMatchesAuthorizedCompletedWork } from "./ro-invoice-guard";

export type CheckoutLine = {
  id: number;
  name: string;
  price: number;
  decision: "approved" | "pending" | "declined";
};
type Phase =
  "working" | "qc" | "invoice_draft" | "invoice_ready" | "paid" | "delivered";
type FrozenLine = { id: number; name: string; price: number };
type CheckoutState = {
  phase: Phase;
  completed: number[];
  qcNotes: string;
  invoiceLines: FrozenLine[];
  paymentMethod?: "Online (demo)" | "Counter (demo)";
  history: string[];
};
const initialState: CheckoutState = {
  phase: "working",
  completed: [],
  qcNotes: "",
  invoiceLines: [],
  history: [],
};
const phases: Phase[] = [
  "working",
  "qc",
  "invoice_draft",
  "invoice_ready",
  "paid",
  "delivered",
];
const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n,
  );
const keyFor = (roId: string) =>
  `shop-revenue-desktop-demo-checkout-v1:${roId}`;
function isState(data: unknown): data is CheckoutState {
  if (!data || typeof data !== "object") return false;
  const d = data as CheckoutState;
  return (
    phases.includes(d.phase) &&
    Array.isArray(d.completed) &&
    d.completed.every(Number.isInteger) &&
    Array.isArray(d.invoiceLines) &&
    d.invoiceLines.every(
      (l) =>
        typeof l.id === "number" &&
        typeof l.name === "string" &&
        typeof l.price === "number" &&
        Number.isFinite(l.price) &&
        l.price >= 0,
    ) &&
    typeof d.qcNotes === "string" &&
    Array.isArray(d.history)
  );
}
export function useDemoCheckout(roId: string) {
  const [state, setState] = useState<CheckoutState>(initialState);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    let stored: CheckoutState | null = null;
    try {
      const raw = sessionStorage.getItem(keyFor(roId));
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isState(parsed)) stored = parsed;
      }
    } catch {
      /* Browser preview can work without saved data. */
    }
    queueMicrotask(() => {
      if (!active) return;
      setState(stored ?? initialState);
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [roId]);
  function update(next: CheckoutState) {
    setState(next);
    try {
      sessionStorage.setItem(keyFor(roId), JSON.stringify(next));
    } catch {
      /* Session-only preview. */
    }
  }
  return { state, loaded, update };
}

export function AdvisorCheckoutDemo({
  roId,
  jobs,
}: {
  roId: string;
  jobs: CheckoutLine[];
}) {
  const { state, loaded, update } = useDemoCheckout(roId);
  const [notes, setNotes] = useState("");
  const [paymentChoice, setPaymentChoice] = useState<
    "Online (demo)" | "Counter (demo)"
  >("Counter (demo)");
  const [resetOpen, setResetOpen] = useState(false);
  const approved = jobs.filter((j) => j.decision === "approved");
  const completed = approved.filter((j) => state.completed.includes(j.id));
  const total = state.invoiceLines.reduce((sum, l) => sum + l.price, 0);
  const allCompleted =
    approved.length > 0 && completed.length === approved.length;
  const invoiceCurrent = invoiceMatchesAuthorizedCompletedWork(
    state.invoiceLines, jobs, state.completed
  );
  const index = phases.indexOf(state.phase);
  const log = (
    phase: Phase,
    label: string,
    extra: Partial<CheckoutState> = {},
  ) =>
    update({ ...state, ...extra, phase, history: [...state.history, label] });
  function toggleComplete(id: number) {
    if (state.phase !== "working") return;
    update({
      ...state,
      invoiceLines: [],
      completed: state.completed.includes(id)
        ? state.completed.filter((x) => x !== id)
        : [...state.completed, id],
    });
  }
  function makeDraft() {
    if (!allCompleted || state.phase !== "qc") return;
    const invoiceLines = eligibleInvoiceLines(jobs, state.completed);
    if (!invoiceLines.length || invoiceLines.length !== approved.length) return;
    log("invoice_draft", "Advisor passed QC; eligible completed work copied to the invoice draft.", {
      qcNotes: notes,
      invoiceLines,
    });
  }
  function finalizeInvoice() {
    if (state.phase !== "invoice_draft" || !invoiceCurrent) return;
    log("invoice_ready", "Advisor verified completed, authorized work and finalized the demo invoice.");
  }
  function reset() {
    update(initialState);
    setNotes("");
    setResetOpen(false);
  }
  return (
    <section
      id="ro-checkout-workspace"
      className={styles.panel}
      aria-label="Technician completion, quality control, invoice and delivery"
    >
      <div className={styles.panelHeader}>
        <div>
          <div className={styles.eyebrow}>WORKFLOW · RO {roId}</div>
          <h2>Work → QC → Cashiering → Delivery</h2>
          <p>
            Each milestone has an explicit handoff. No invoice can be issued
            until all approved work is completed and QC is passed.
          </p>
        </div>
        <span
          className={
            state.phase === "delivered" ? styles.approvedTag : styles.pendingTag
          }
        >
          {phases.indexOf(state.phase) + 1} / 6 ·{" "}
          {state.phase.replaceAll("_", " ")}
        </span>
      </div>
      {!loaded ? (
        <p className={styles.vehicleEmpty}>Loading demo workflow…</p>
      ) : (
        <>
          <div className={styles.checkoutSteps}>
            {[
              "Technician",
              "Ready for QC",
              "Draft invoice",
              "Invoice sent",
              "Paid",
              "Delivered",
            ].map((s, i) => (
              <div
                key={s}
                className={index >= i ? styles.checkoutStepDone : ""}
              >
                <span>{index > i ? "✓" : i + 1}</span>
                <small>{s}</small>
              </div>
            ))}
          </div>
          {state.phase === "working" && (
            <div className={styles.checkoutBody}>
              <h3>Technician: complete authorized work</h3>
              <p>
                Mark individual services finished. Pending or declined
                recommendations never enter the work checklist.
              </p>
              {approved.map((j) => (
                <label key={j.id} className={styles.checkoutChecklist}>
                  <input
                    type="checkbox"
                    checked={state.completed.includes(j.id)}
                    onChange={() => toggleComplete(j.id)}
                  />
                  <span>{j.name}</span>
                  <strong>{money(j.price)}</strong>
                </label>
              ))}
              {!approved.length && (
                <p>
                  No approved jobs yet. Obtain customer authorization first.
                </p>
              )}
              <div className={styles.checkoutActions}>
                <button
                  type="button"
                  className={styles.addButton}
                  disabled={!allCompleted}
                  onClick={() =>
                    log(
                      "qc",
                      "Technician marked all authorized jobs complete; vehicle returned for QC.",
                    )
                  }
                >
                  Complete work → Ready for QC
                </button>
                {!allCompleted && (
                  <span className={styles.note}>
                    {completed.length} of {approved.length} authorized services
                    finished
                  </span>
                )}
              </div>
            </div>
          )}
          {state.phase === "qc" && (
            <div className={styles.checkoutBody}>
              <h3>Advisor: quality-control check</h3>
              <p>
                Confirm the technician returned the vehicle, every approved
                service is completed, and any concerns are resolved.
              </p>
              {approved.map((j) => (
                <div key={j.id} className={styles.checkoutLine}>
                  <span>✓ {j.name}</span>
                  <strong>Completed</strong>
                </div>
              ))}
              <label className={styles.checkoutField}>
                Final QC / pickup notes (optional)
                <textarea
                  rows={2}
                  maxLength={500}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Road test completed; vehicle washed; keys at service counter."
                />
              </label>
              <div className={styles.checkoutActions}>
                <button
                  type="button"
                  className={styles.addButton}
                  disabled={!allCompleted}
                  onClick={makeDraft}
                >
                  Pass QC → Prepare invoice
                </button>
                <button
                  type="button"
                  className={styles.returnButton}
                  onClick={() =>
                    log(
                      "working",
                      "QC returned vehicle to technician for correction.",
                    )
                  }
                >
                  Return to technician
                </button>
              </div>
            </div>
          )}
          {state.phase === "invoice_draft" && (
            <div className={styles.checkoutBody}>
              <h3>Advisor: review draft invoice</h3>
              <p>
                Draft built automatically from completed, approved work. No
                declined or pending service is included.
              </p>
              {state.invoiceLines.map((j) => (
                <div key={j.id} className={styles.checkoutLine}>
                  <span>{j.name}</span>
                  <strong>{money(j.price)}</strong>
                </div>
              ))}
              <div className={styles.checkoutAmount}>
                <span>Illustrative subtotal · taxes and fees not included</span>
                <strong>{money(total)}</strong>
              </div>
              {!invoiceCurrent && (
                <p className={styles.checkoutGuardError} role="alert">
                  Approved services or prices changed after QC. Return to QC and prepare a fresh invoice. Declined, pending, or unfinished items cannot be billed.
                </p>
              )}
              <div className={styles.checkoutActions}>
                <button
                  type="button"
                  className={styles.addButton}
                  disabled={!invoiceCurrent}
                  onClick={finalizeInvoice}
                >
                  Finalize invoice → Customer checkout
                </button>
                <button
                  type="button"
                  className={styles.returnButton}
                  onClick={() =>
                    log("qc", "Invoice returned to QC for corrections.", {
                      invoiceLines: [],
                    })
                  }
                >
                  Return to QC
                </button>
              </div>
            </div>
          )}
          {state.phase === "invoice_ready" && (
            <div className={styles.checkoutBody}>
              <h3>Invoice ready · awaiting payment</h3>
              <p>
                Customer can now open their link, review this invoice and
                simulate an online payment. An in-person payment may also be
                recorded below.
              </p>
              <div className={styles.checkoutAmount}>
                <span>Demo amount due before taxes/fees</span>
                <strong>{money(total)}</strong>
              </div>
              <div className={styles.checkoutActions}>
                <Link
                  className={styles.returnButton}
                  href={`/desktop-demo?screen=checkout&ro=${encodeURIComponent(roId)}`}
                >
                  Open customer checkout ↗
                </Link>
              </div>
              <div className={styles.checkoutActions}>
                <label className={styles.checkoutField}>
                  Record mock counter payment
                  <select
                    value={paymentChoice}
                    onChange={(e) =>
                      setPaymentChoice(
                        e.target.value as "Online (demo)" | "Counter (demo)",
                      )
                    }
                  >
                    <option value="Counter (demo)">
                      Cash / card at counter (simulation)
                    </option>
                  </select>
                </label>
                <button
                  type="button"
                  className={styles.addButton}
                  onClick={() =>
                    log(
                      "paid",
                      `Mock payment recorded by shop: ${paymentChoice}.`,
                      { paymentMethod: paymentChoice },
                    )
                  }
                >
                  Record payment (demo)
                </button>
              </div>
            </div>
          )}
          {state.phase === "paid" && (
            <div className={styles.checkoutBody}>
              <h3>Paid — vehicle awaiting pickup</h3>
              <p>
                Payment is recorded, but the RO remains open until staff hand
                the vehicle and keys back to the customer.
              </p>
              <div className={styles.checkoutAmount}>
                <span>Demo amount collected</span>
                <strong>{money(total)}</strong>
              </div>
              <button
                type="button"
                className={styles.addButton}
                onClick={() =>
                  log(
                    "delivered",
                    "Vehicle and keys returned to customer; RO closed in demo.",
                  )
                }
              >
                Confirm vehicle delivery → Close RO
              </button>
            </div>
          )}
          {state.phase === "delivered" && (
            <div className={styles.checkoutBody}>
              <h3>RO closed · delivered</h3>
              <p>
                Authorized work completed, QC approved, invoice finalized,
                payment recorded, and vehicle delivered.
              </p>
              <div className={styles.checkoutAmount}>
                <span>Demo paid total</span>
                <strong>{money(total)}</strong>
              </div>
            </div>
          )}
          <div className={styles.checkoutHistory}>
            <strong>Activity history (this preview browser)</strong>
            {state.history.length ? (
              state.history.map((entry, i) => <p key={i}>✓ {entry}</p>)
            ) : (
              <p>Work is still in progress. No handoffs recorded.</p>
            )}
          </div>
          <div className={styles.checkoutActions}>
            <button
              type="button"
              className={styles.mobileTextButton}
              onClick={() => setResetOpen(!resetOpen)}
            >
              Reset demo workflow
            </button>
            {resetOpen && (
              <>
                <button
                  type="button"
                  className={styles.removeApprovalButton}
                  onClick={reset}
                >
                  Confirm reset
                </button>
                <button type="button" onClick={() => setResetOpen(false)}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </>
      )}
      <div className={styles.note}>
        Sample-data demo. Buttons save only to this browser session. No
        technician updates, real QC sign-offs, invoices, payments, or delivery
        events are written to production.
      </div>
    </section>
  );
}

export function CustomerCheckoutDemo({
  roId,
  vehicle,
}: {
  roId: string;
  vehicle: string;
}) {
  const { state, loaded, update } = useDemoCheckout(roId);
  const [showConfirm, setShowConfirm] = useState(false);
  const total = state.invoiceLines.reduce((sum, l) => sum + l.price, 0);
  if (!loaded)
    return (
      <div className={styles.customerCheckoutScreen}>
        <p>Loading your service status…</p>
      </div>
    );
  const ready = state.phase === "invoice_ready";
  const paid = state.phase === "paid";
  const delivered = state.phase === "delivered";
  return (
    <main className={styles.customerCheckoutScreen}>
      <div className={styles.mobileShopBrand}>
        ◆ SHOP REVENUE <span>DEMO</span>
      </div>
      <div className={styles.customerCheckoutCard}>
        <p className={styles.eyebrow}>YOUR SERVICE UPDATE · {roId}</p>
        <h1>{vehicle}</h1>
        <div className={styles.customerCheckoutStatus}>
          {delivered
            ? "Vehicle delivered"
            : paid
              ? "Payment received"
              : ready
                ? "Your vehicle is ready"
                : state.phase === "invoice_draft"
                  ? "Work complete · invoice being prepared"
                  : state.phase === "qc"
                    ? "Work complete · final quality check"
                    : "Your vehicle is being serviced"}
        </div>
        {ready || paid || delivered ? (
          <>
            <h2>
              {delivered
                ? "Your visit is complete"
                : paid
                  ? "Thank you for your payment"
                  : "Review your invoice"}
            </h2>
            <p>
              {delivered
                ? "The vehicle was delivered and this repair order is closed."
                : paid
                  ? "Your payment has been recorded. Your vehicle is awaiting pickup."
                  : "All approved work has been completed and the advisor finalized your invoice."}
            </p>
            <div className={styles.checkoutReceipt}>
              {state.invoiceLines.map((l) => (
                <div key={l.id}>
                  <span>{l.name}</span>
                  <strong>{money(l.price)}</strong>
                </div>
              ))}
              <div className={styles.checkoutAmount}>
                <span>Illustrative subtotal · excludes taxes and fees</span>
                <strong>{money(total)}</strong>
              </div>
            </div>
            {ready &&
              (!showConfirm ? (
                <button
                  type="button"
                  className={styles.mobilePrimaryButton}
                  onClick={() => setShowConfirm(true)}
                >
                  Continue to payment (demo) →
                </button>
              ) : (
                <div className={styles.checkoutPaymentConfirm}>
                  <h3>Simulate online payment</h3>
                  <p>
                    No card number is requested, no charge is made and no real
                    receipt is issued.
                  </p>
                  <button
                    type="button"
                    className={styles.mobilePrimaryButton}
                    onClick={() => {
                      update({
                        ...state,
                        phase: "paid",
                        paymentMethod: "Online (demo)",
                        history: [
                          ...state.history,
                          "Customer recorded simulated online payment.",
                        ],
                      });
                      setShowConfirm(false);
                    }}
                  >
                    Confirm mock payment of {money(total)}
                  </button>
                  <button
                    type="button"
                    className={styles.mobileTextButton}
                    onClick={() => setShowConfirm(false)}
                  >
                    Cancel
                  </button>
                </div>
              ))}
            {paid && (
              <p className={styles.mobileNextPrompt}>
                Payment complete. Please collect your vehicle and keys from the
                shop. The service advisor will mark your RO delivered when you
                pick up.
              </p>
            )}
            {delivered && (
              <div className={styles.mobileSuccessMessage}>
                ✓ Paid and vehicle delivered. RO closed.
              </div>
            )}
          </>
        ) : (
          <div className={styles.mobileNextPrompt}>
            {state.phase === "invoice_draft"
              ? "Your work is finished; your advisor is reviewing the bill."
              : state.phase === "qc"
                ? "Your technician has finished the work. A final quality check is underway."
                : "The technician is completing your authorized services. You can review your inspection and recommendations while work continues."}
            <p>
              Checkout will appear when all approved work is complete, QC
              passes, and an invoice is finalized.
            </p>
          </div>
        )}
        <div className={styles.estimateDisclaimer}>
          Fictional-data preview only. The shop and customer must use the same
          browser session to see the same demo state; this is not a live payment
          page.
        </div>
        <Link
          className={styles.returnButton}
          href={`/desktop-demo?screen=customer-link&ro=${encodeURIComponent(roId)}`}
        >
          ← Back to service visit
        </Link>
      </div>
    </main>
  );
}
