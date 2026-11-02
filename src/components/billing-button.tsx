"use client";
import { useActionHydration } from "./action-hydration";
import { useState, useTransition } from "react";
import {
  openBillingPortalAction,
  startSubscriptionAction,
} from "@/server/actions/billing";

export function BillingButton({
  kind,
  label,
  primary = true,
}: {
  kind: "start" | "portal";
  label: string;
  primary?: boolean;
}) {
  const [busy, start] = useTransition();
  const [message, setMessage] = useState("");
  const ready = useActionHydration();
  return (
    <div data-ux-ready={ready}>
      <button
        className={`btn ${primary ? "primary" : "secondary"}`}
        disabled={busy}
        onClick={() =>
          start(async () => {
            try {
              const r =
                kind === "start"
                  ? await startSubscriptionAction()
                  : await openBillingPortalAction();
              if (!r.ok) {
                setMessage(
                  `${r.error.message} (reference ${r.error.referenceId})`,
                );
                return;
              }
              const u = new URL(r.data.url);
              if (
                u.protocol === "https:" &&
                (u.hostname === "stripe.com" ||
                  u.hostname.endsWith(".stripe.com"))
              ) {
                window.location.assign(u.href);
                return;
              }
              setMessage("Stripe returned an unexpected address.");
            } catch {
              setMessage("Could not reach Stripe. Please try again.");
            }
          })
        }
      >
        {busy ? "Opening Stripe…" : label}
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
