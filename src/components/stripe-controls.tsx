"use client";
import { useActionHydration } from "./action-hydration";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelStripeCheckoutAction,
  retryStripeRefundAction,
  connectStripeAction,
  payInvoiceAction,
  reconcileStripeAction,
  refundStripeAction,
} from "@/server/actions/payments";
export function StripeButton({
  kind,
  token,
  checkoutId,
  label,
  disabled = false,
  describedBy,
}: {
  kind:
    | "connect"
    | "setup-status"
    | "pay"
    | "reconcile"
    | "cancel"
    | "retry-refund";
  token?: string;
  checkoutId?: string;
  label?: string;
  disabled?: boolean;
  describedBy?: string;
}) {
  const [busy, start] = useTransition();
  const [message, setMessage] = useState("");
  const ready = useActionHydration();
  const router = useRouter();
  return (
    <div data-ux-ready={ready}>
      <button
        className={`btn ${kind === "cancel" || kind === "retry-refund" ? "danger" : !disabled && (kind === "pay" || kind === "connect" || kind === "setup-status") ? "primary" : "secondary"}`}
        disabled={disabled || busy || !ready}
        aria-describedby={describedBy}
        onClick={() =>
          start(async () => {
            try {
              if (kind === "setup-status") {
                router.refresh();
                return;
              }
              const actions = {
                connect: () => connectStripeAction(),
                pay: () => payInvoiceAction(token!),
                reconcile: () => reconcileStripeAction(),
                cancel: () => cancelStripeCheckoutAction({ id: checkoutId }),
                "retry-refund": () => retryStripeRefundAction(checkoutId),
              };
              const r = await actions[kind]();
              if (!r.ok) {
                setMessage(
                  `${r.error.message} (reference ${r.error.referenceId})`,
                );
                return;
              }
              const data = r.data as { url?: string; message?: string };
              if (data.url) {
                const u = new URL(data.url);
                if (
                  u.protocol === "https:" &&
                  (u.hostname === "stripe.com" ||
                    u.hostname.endsWith(".stripe.com"))
                ) {
                  window.location.assign(u.href);
                  return;
                }
              }
              setMessage(
                data.message || "Payment confirmed. Refreshing your invoice.",
              );
              router.refresh();
            } catch {
              setMessage(
                "Could not reach the payment service. Please try again.",
              );
            }
          })
        }
      >
        {busy
          ? kind === "setup-status"
            ? "Checking setup…"
            : "Checking Stripe…"
          : kind === "retry-refund"
            ? "Retry / check this refund"
            : kind === "connect"
              ? label || "Connect Stripe"
              : kind === "setup-status"
                ? "Check setup status"
                : kind === "cancel"
                  ? "Cancel unpaid checkout"
                  : kind === "pay"
                    ? "Pay online securely"
                    : "Refresh payment status"}
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
export function StripeRefundForm({
  paymentId,
  maxCents,
}: {
  paymentId: string;
  maxCents: number;
}) {
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, start] = useTransition();
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const ready = useActionHydration();
  const router = useRouter();
  return (
    <form
      data-ux-ready={ready}
      onSubmit={(e) => {
        e.preventDefault();
        if (!confirming) {
          setConfirming(true);
          return;
        }
        const form = e.currentTarget;
        const data = new FormData(form);
        const amount = String(data.get("amount") || "");
        if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
          setMessage("Enter a valid dollar amount.");
          return;
        }
        const cents = Math.round(Number(amount) * 100);
        start(async () => {
          try {
            const r = await refundStripeAction({
              paymentId,
              amountCents: cents,
              reason: String(data.get("reason") || ""),
              requestId,
            });
            if (!r.ok) {
              setMessage(r.error.message);
              if (r.error.code === "VALIDATION") {
                setRequestId(crypto.randomUUID());
                setConfirming(false);
              }
              return;
            }
            setMessage(
              r.data.status === "succeeded"
                ? "Refund confirmed by Stripe."
                : "Refund submitted. Refresh payment status to check progress.",
            );
            setRequestId(crypto.randomUUID());
            setConfirming(false);
            form.reset();
            router.refresh();
          } catch {
            setMessage(
              "The result is uncertain. Refresh payment status before retrying this same request.",
            );
          }
        });
      }}
    >
      <fieldset className="hydration-fields" disabled={!ready}>
        <label htmlFor={`refund-amount-${paymentId}`}>Refund amount ($)</label>
        <input
          id={`refund-amount-${paymentId}`}
          name="amount"
          type="number"
          min="0.01"
          max={maxCents / 100}
          step="0.01"
          required
          defaultValue={(maxCents / 100).toFixed(2)}
          readOnly={confirming}
          disabled={busy}
        />
        <label htmlFor={`refund-reason-${paymentId}`}>Refund reason</label>
        <input
          id={`refund-reason-${paymentId}`}
          name="reason"
          required
          maxLength={1000}
          readOnly={confirming}
          disabled={busy}
        />
        {confirming && (
          <p role="alert">
            Confirm: send this refund through Stripe? This moves money back to
            the customer.
          </p>
        )}
        <button className="btn danger" disabled={busy}>
          {busy
            ? "Submitting refund…"
            : confirming
              ? "Confirm Stripe refund"
              : "Review refund"}
        </button>
        {confirming && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        )}
        {message && <p role="status">{message}</p>}
      </fieldset>
    </form>
  );
}
