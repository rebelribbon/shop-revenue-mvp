"use client";
import Link from "next/link";
export default function ShopError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const reference =
    error &&
    typeof error === "object" &&
    "digest" in error &&
    typeof error.digest === "string"
      ? error.digest
      : null;
  return (
    <main id="main-content" tabIndex={-1}>
      <h1>This page couldn’t load</h1>
      <p>
        Your saved records are still available. Try loading this page again.
      </p>
      <button className="btn primary" onClick={() => retry()}>
        Try again
      </button>
      <p>
        <Link href="/app">Return to Money</Link>
      </p>
      {reference && <p className="muted">Support reference: {reference}</p>}
    </main>
  );
}
