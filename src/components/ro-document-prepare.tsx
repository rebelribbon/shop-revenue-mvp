"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { freezeEstimateAction } from "@/server/actions/estimates";
import { useActionHydration } from "./action-hydration";

export function RoDocumentPrepare({
  jobId,
  version,
  taxRateBps,
  readyToPrepare,
  policyConfigured,
}: {
  jobId: string;
  version: string;
  taxRateBps: number;
  readyToPrepare: boolean;
  policyConfigured: boolean;
}) {
  const router = useRouter();
  const hydrated = useActionHydration();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  async function prepare() {
    if (!hydrated || !readyToPrepare || !policyConfigured || pending) return;
    setPending(true);
    setError("");
    try {
      const result = await freezeEstimateAction({
        jobId,
        expectedJobVersion: version,
        taxBps: taxRateBps,
        terms: "",
        supplementReason: "",
        clientRequestId: requestId,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setRequestId(crypto.randomUUID());
      router.replace(`/app/jobs?job=${encodeURIComponent(jobId)}&tab=proposal&share=1`);
      router.refresh();
    } catch {
      setError("Could not prepare the estimate. Your priced work has been saved; try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="ro-documents-prepare proposal-preparation" data-ux-ready={hydrated} aria-label="Finalize customer proposal">
      <div className="proposal-preparation-head">
        <div>
          <p className="muted">STEP 2 OF 4 · REVIEW &amp; FINALIZE</p>
          <h3>Ready to send to the customer?</h3>
          <p>Confirm repair prices, then finalize the customer authorization. Sending is the next screen.</p>
        </div>
      </div>
      {!readyToPrepare && (
        <p className="notice" role="alert">Parts and labor still need valid prices and costs. Return to pricing to finish before finalizing.</p>
      )}
      {!policyConfigured && (
        <div className="notice" role="alert">
          <strong>Sending is blocked by platform setup.</strong>
          <p>No approved authorization agreement exists for this jurisdiction. An authorized platform administrator must review and approve the agreement in <strong>Admin → Legal policies</strong> before any customer can sign. The draft and pricing are saved; the customer has not been sent anything.</p>
        </div>
      )}
      <button
        type="button"
        className="btn primary"
        disabled={!hydrated || pending || !readyToPrepare || !policyConfigured}
        onClick={() => void prepare()}
      >
        {pending ? "Finalizing…" : "Finalize & continue to send"}
      </button>
      {error && <p className="notice" role="alert">{error}</p>}
    </section>
  );
}
