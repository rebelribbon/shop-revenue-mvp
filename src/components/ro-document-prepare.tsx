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
      router.replace(
        `/app/jobs?job=${encodeURIComponent(jobId)}&tab=files#file-cabinet`,
      );
      router.refresh();
    } catch {
      setError(
        "Could not prepare the estimate. Your priced work has been saved; try again.",
      );
    } finally {
      setPending(false);
    ¶»§q«^