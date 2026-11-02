"use client";
import { useState } from "react";

// Copy, text or email a customer link using this site's address.
export function CopyLink({
  path,
  label = "Copy link",
  title,
  phone,
  email,
}: {
  path: string;
  label?: string;
  title?: string;
  phone?: string | null;
  email?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const url = () => `${window.location.origin}${path}`;
  const message = () =>
    `${title ? `Please review and sign: ${title}\n` : ""}${url()}`;
  return (
    <>
      <button
        type="button"
        className="btn secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url());
            setCopied(true);
          } catch {
            window.prompt("Copy this link", url());
          }
        }}
      >
        {copied ? "Copied" : label}
      </button>
      {phone && (
        <button
          type="button"
          className="btn secondary"
          onClick={() =>
            window.location.assign(
              `sms:${phone}?&body=${encodeURIComponent(message())}`,
            )
          }
        >
          Text it
        </button>
      )}
      {email && (
        <button
          type="button"
          className="btn secondary"
          onClick={() =>
            window.location.assign(
              `mailto:${email}?subject=${encodeURIComponent(title ? `Please sign: ${title}` : "Document")}&body=${encodeURIComponent(message())}`,
            )
          }
        >
          Email it
        </button>
      )}
    </>
  );
}
