"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { freezeEstimateAction } from "@/server/actions/estimates";
import { useActionHydration } from "./action-hydration";
import { RoProposalProgress } from "./ro-proposal-progress";

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
      router.replace(
        `/app/jobs?job=${encodeURIComponent(jobId)}#customer-proposal-review`,
      );
      router.refresh();
    } catch {
      setError(
        "Could not prepare the estimate. Your priced work has been saved; try again.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      id="proposal-finalize"
      className="ro-documents-prepare proposal-preparation"
      data-ux-ready={hydrated}
      aria-label="Finalize customer proposal"
    >
      <RoProposalProgress stage="review" />
      <div className="proposal-preparation-head">
        <div>
          <p className="muted">STEP 2 OF 4 · REVIEW &amp; FINALIZE</p>
          <h3>Review and finalize the customer packet</h3>
          <p>
            Review the estimate and supporting documents above. Finalize here,
            then send the packet immediately below without leaving the RO.
          </p>
        </div>
      </div>
      {!readyToPrepare && (
        <p className="notice" role="alert">
          Parts and labor still need valid prices and costs. Return to pricing
          to finish before finalizing.
        </p>
      )}
      {!policyConfigured && (
        <div className="notice" role="alert">
          <strong>Customer authorization setup required</strong>
          <p>
            An approved agreement is missing for this jurisdiction. A platform
            administrator must approve it before estimates can be sent for
            signature. Your priced draft is saved; no email was sent.
          </p>
          <a href="/admin/policies" className="ro-edit-pricing-link">
            Open platform legal policies (admin access)
          </a>
        </div>
      )}
      <button
        type="button"
        className="btn primary"
        disabled={!hydrated || pending || !readyToPrepare || !policyConfigured}
        onClick={() => void prepare()}
      >
        {pending ? "Finalizing…" : "Finalize estimate & prepare to send"}
      </button>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
