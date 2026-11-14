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
      router.replace(`/app/jobs?job=${encodeURIComponent(jobId)}&tab=files#file-cabinet`);
      router.refresh();
    } catch {
      setError("Could not prepare the estimate. Your priced work has been saved; try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="ro-documents-prepare" data-ux-ready={hydrated}>
      <h4>Customer estimate — Draft</h4>
      <p>Review the customer preview below. Only prepare and send when every part and labor price is correct.</p>
      {!policyConfigured && (
        <p className="notice" role="alert">
          Customer approval cannot be sent yet: the platform has no approved estimate-authorization agreement for this shop's jurisdiction. A platform administrator must configure and approve one. The draft remains visible below, and no message has been sent.
        </p>
      )}
      {!readyToPrepare && <p className="notice">Complete the parts and labor pricing before preparing an estimate.</p>}
      <button
        type="button"
        className="btn primary"
        disabled={!hydrated || pending || !readyToPrepare || !policyConfigured}
        onClick={() => void prepare()}
      >
        {pending ? "Preparing…" : "Finalize estimate for customer"}
      </button>
      <p className="muted">Finalizing stores a fixed version in Documents. You choose the customer recipient and send it from this screen.</p>
      {error && <p className="notice" role="alert">{error}</p>}
    </section>
  );
}
