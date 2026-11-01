"use client";
import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
export function RefreshJobStatus() {
  const router = useRouter();
  const [pending, start] = useTransition();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = window.setInterval(refresh, 30000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(interval);
    };
  }, [router]);
  return (
    <details>
      <summary>Check for reply</summary>
      <button
        type="button"
        className="btn secondary"
        disabled={pending}
        onClick={() => start(() => router.refresh())}
      >
        {pending ? "Checking…" : "Check now"}
      </button>
    </details>
  );
}
