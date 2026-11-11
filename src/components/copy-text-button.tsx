"use client";

import { useState } from "react";
import { useActionHydration } from "./action-hydration";

export function CopyTextButton({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const ready = useActionHydration();
  const [result, setResult] = useState<{ value: string; ok: boolean } | null>(
    null,
  );
  const current = result?.value === value ? result : null;
  return (
    <span className="copy-control">
      <button
        type="button"
        className="btn secondary compact-btn"
        aria-label={label}
        data-ux-utility="true"
        disabled={!ready}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setResult({ value, ok: true });
          } catch {
            setResult({ value, ok: false });
          }
        }}
      >
        Copy
      </button>
      <span role="status" className="copy-feedback muted">
        {current
          ? current.ok
            ? "Copied."
            : "Select the value to copy it."
          : ""}
      </span>
    </span>
  );
}
