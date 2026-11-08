"use client";
import { useState } from "react";

// Copy, text or email a customer link using this site's address.
export function CopyLink({
  path,
  label = "Copy link",
  title,
  phone,
  email,
  intro,
}: {
  path: string;
  // What the text/email says above the link. Defaults to a signing ask.
  intro?: string;
  label?: string;
  title?: string;
  phone?: string | null;
  email?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState(email ?? "");
  const [recipientPhone, setRecipientPhone] = useState(phone ?? "");
  const url = () => `${window.location.origin}${path}`;
  const message = () =>
    `${intro ? `${intro}\n` : title ? `Please review and sign: ${title}\n` : ""}${url()}`;
  return (
    <>
      <button
        type="button"
        className="btn secondary"
        data-link-path={path}
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
      <details className="record-details">
        <summary>Send signing link</summary>
        <p>
          Confirm where to send it. Opening your messaging app does not send the
          link automatically.
        </p>
        <label>
          Recipient email
          <input
            type="email"
            value={recipientEmail}
            onChange={(e) => setRecipientEmail(e.target.value)}
            placeholder="customer@example.com"
            autoComplete="email"
          />
        </label>
        <label>
          Recipient mobile number
          <input
            type="tel"
            value={recipientPhone}
            onChange={(e) => setRecipientPhone(e.target.value)}
            placeholder="Customer mobile number"
            autoComplete="tel"
          />
        </label>
        <div className="money-actions">
          {recipientPhone.trim() && (
            <button
              type="button"
              className="btn secondary"
              onClick={() =>
                window.location.assign(
                  `sms:${recipientPhone.trim()}?body=${encodeURIComponent(message())}`,
                )
              }
            >
              Open text message
            </button>
          )}
          {recipientEmail.trim() && (
            <button
              type="button"
              className="btn secondary"
              disabled={
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim())
              }
              onClick={() =>
                window.location.assign(
                  `mailto:${encodeURIComponent(recipientEmail.trim()).replace(/%40/gi, "@")}?subject=${encodeURIComponent(intro && title ? title : title ? `Please sign: ${title}` : "Document")}&body=${encodeURIComponent(message())}`,
                )
              }
            >
              Open email message
            </button>
          )}
        </div>
      </details>
    </>
  );
}
