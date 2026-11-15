"use client";

import { useEffect } from "react";

// Record a real customer page load, not a fabricated email-open pixel.
// It does not use polling and the server de-duplicates rapid refreshes.
export function ProposalOpenTracker({ token }: { token: string }) {
  useEffect(() => {
    // The advisor's exact-page preview is not a customer open event.
    if (new URLSearchParams(window.location.search).has("advisor_preview")) return;
    const controller = new AbortController();
    void fetch("/api/proposal/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      cache: "no-store",
      signal: controller.signal,
    }).catch(() => undefined);
    return () => controller.abort();
  }, [token]);
  return null;
}
