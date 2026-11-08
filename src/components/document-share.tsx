"use client";
import { useActionHydration } from "./action-hydration";
import { rotateEstimateLinkAction } from "@/server/actions/estimates";
import { rotateInvoiceLinkAction } from "@/server/actions/invoices";
import { useEffect, useState } from "react";
import {
  emailCustomerDocument,
  prepareDocumentShare,
} from "@/server/actions/document-sharing";
import type { ShareRecipient, PacketDocument } from "@/domain/document-sharing";

export type ShareData = ShareRecipient & { path: string; documents?: PacketDocument[] };
export function DocumentShare({
  id,
  kind,
  primary = false,
  label,
  initial,
  autoOpen = false,
}: {
  id: string;
  kind: "estimate" | "invoice";
  primary?: boolean;
  label?: string;
  initial?: ShareData;
  autoOpen?: boolean;
}) {
  const ready = useActionHydration();
  const [data, setData] = useState<ShareData | null>(initial ?? null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [emailAddress, setEmailAddress] = useState(initial?.email ?? "");
  const [phoneNumber, setPhoneNumber] = useState(initial?.phone ?? "");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [needsReplacement, setNeedsReplacement] = useState(false),
    [revisionPath, setRevisionPath] = useState<string | undefined>();
  const selected = (data?.documents ?? []).filter((doc) => selectedDocuments.includes(doc.id));
  const previewPath = data && kind === "estimate"
    ? `/packet?${new URLSearchParams([
        ["e", data.path.split("/").at(-1) ?? ""],
        ...selected.map((doc): [string, string] => ["d", doc.path.split("/").at(-1) ?? ""]),
      ]).toString()}`
    : data?.path ?? "";
  const url = data
    ? new URL(previewPath,
        typeof window === "undefined" ? "https://example.invalid" : window.location.origin).href
    : "";
  const from = data?.senderName ? ` from ${data.senderName}` : "";
  // Texts carry the opt-out line the FCC's standard keywords rely on.
  const textBody = `Hi ${data?.name ?? ""}, here is your ${kind}${from}: ${url}\n\nReply STOP to opt out.`;
  // Emails carry who sent it, a postal address and how to stop (CAN-SPAM).
  const emailBody = [
    `Hi ${data?.name ?? ""}, here is your ${kind}${from}: ${url}`,
    "",
    [data?.senderName, data?.senderAddress].filter(Boolean).join("\n"),
    "To stop emails from us, reply “unsubscribe”.",
  ].join("\n");
  const canText = Boolean(phoneNumber.trim() && !data?.textStoppedOn);
  const canEmail = Boolean(!data?.emailStoppedOn);
  useEffect(() => {
    if (!autoOpen || initial) return;
    let canceled = false;
    void prepareDocumentShare({ id, kind })
      .then((r) => {
        if (canceled) return;
        if (r.ok) {
          setData(r.data);
          setEmailAddress(r.data.email ?? "");
          setPhoneNumber(r.data.phone ?? "");
        } else {
          setMessage(r.message);
          setNeedsReplacement(
            "needsReplacement" in r && r.needsReplacement === true,
          );
          setRevisionPath("revisionPath" in r ? r.revisionPath : undefined);
        }
      })
      .catch(() => {
        if (!canceled)
          setMessage("Sharing is unavailable. Try opening it again.");
      });
    return () => {
      canceled = true;
    };
  }, [autoOpen, id, kind, initial]);
  const ios =
    typeof navigator !== "undefined" &&
    (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  return (
    <div className="document-sharing" data-ux-ready={ready}>
      {!data ? (
        <button
          type="button"
          className={`btn ${primary ? "primary" : "secondary"}`}
          data-page-primary={primary ? true : undefined}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await prepareDocumentShare({ id, kind });
              if (r.ok) {
                setData(r.data);
                setEmailAddress(r.data.email ?? "");
                setPhoneNumber(r.data.phone ?? "");
              } else {
                setMessage(r.message);
                setNeedsReplacement(
                  "needsReplacement" in r && r.needsReplacement === true,
                );
                setRevisionPath(
                  "revisionPath" in r ? r.revisionPath : undefined,
                );
              }
            } catch {
              setMessage("Unable to open sharing. Try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Opening…" : (label ?? `Send ${kind}`)}
        </button>
      ) : (
        <section aria-label={`Send ${kind}`}>
          <h4>Send {kind} for customer review</h4>
          <p>
            <strong>Recipient:</strong> {data.name}. Confirm the email or phone
            below before sending. The estimate is already saved in the job file
            cabinet.
          </p>
          {!data.emailStoppedOn && (
            <label>
              Customer email address
              <input
                type="email"
                value={emailAddress}
                onChange={(e) => setEmailAddress(e.target.value)}
                placeholder="customer@example.com"
                autoComplete="email"
              />
            </label>
          )}
          {!data.textStoppedOn && (
            <label>
              Customer mobile number
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="Customer mobile number"
                autoComplete="tel"
              />
            </label>
          )}
          {kind === "estimate" && (
            <section className="card" aria-label="Customer signing packet">
              <h4>Documents included in this request</h4>
              <p>Estimate &amp; work authorization (required)</p>
              {(data.documents ?? []).map((doc) => (
                <label key={doc.id}>
                  <input
                    type="checkbox"
                    checked={selectedDocuments.includes(doc.id)}
                    onChange={(e) => setSelectedDocuments((previous) =>
                      e.target.checked
                        ? [...previous, doc.id]
                        : previous.filter((id) => id !== doc.id))}
                  />
                  {doc.title} · additional signature
                </label>
              ))}
              {!data.documents?.length && (
                <p className="muted">No additional unsigned agreements have been prepared for this job.</p>
              )}
              <p className="muted">
                One link will show the estimate and {selected.length} additional agreement{selected.length === 1 ? "" : "s"}.
                Any newly added work or price needs a new shop-prepared estimate.
              </p>
            </section>
          )}
          <label>
            Email subject
            <input
              value={emailSubject || `${data.senderName || "Your shop"} — ${kind === "estimate" ? "estimate for approval" : "invoice"}`}
              onChange={(e) => setEmailSubject(e.target.value)}
              maxLength={160}
            />
          </label>
          <label>
            Message to customer
            <textarea
              value={emailMessage}
              onChange={(e) => setEmailMessage(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={`Please review and ${kind === "estimate" ? "authorize the proposed work" : "review your invoice"} using the secure link below.`}
            />
          </label>
          <p className="muted">Preview the exact customer packet before sending. The app records provider acceptance, not whether the recipient opened it. SMS opens your texting app; it is not sent automatically.</p>
          <a className="btn secondary" href={previewPath} target="_blank" rel="noreferrer">
            Preview customer view
          </a>
          <div className="money-actions">
            {canText && (
              <a
                className={`btn ${primary ? "primary" : "secondary"}`}
                data-page-primary={primary ? true : undefined}
                href={`sms:${encodeURIComponent(phoneNumber)}${ios ? "&" : "?"}body=${encodeURIComponent(textBody)}`}
              >
                Text to customer
              </a>
            )}
            {canEmail && emailAddress.trim() && (
              <button
                type="button"
                className={`btn ${primary ? "primary" : "secondary"}`}
                disabled={
                  sendingEmail ||
                  !ready ||
                  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress.trim())
                }
                onClick={async () => {
                  setSendingEmail(true);
                  setMessage("");
                  try {
                    const r = await emailCustomerDocument({
                      id,
                      kind,
                      email: emailAddress.trim(),
                      subject: emailSubject.trim() || `${data.senderName || "Your shop"} — ${kind === "estimate" ? "estimate for approval" : "invoice"}`,
                      message: emailMessage.trim() || `Please review and ${kind === "estimate" ? "authorize the proposed work" : "review your invoice"} using the secure link below.`,
                      documentIds: kind === "estimate" ? selected.map((doc) => doc.id) : [],
                    });
                    setMessage(r.message);
                  } catch {
                    setMessage(
                      "Email could not be submitted. Use Open email app or Copy link instead.",
                    );
                  } finally {
                    setSendingEmail(false);
                  }
                }}
              >
                {sendingEmail ? "Submitting…" : "Send email now"}
              </button>
            )}
            {canEmail && emailAddress.trim() && (
              <a
                className={`btn ${primary && !canText ? "primary" : "secondary"}`}
                data-page-primary={primary && !canText ? true : undefined}
                href={`mailto:${encodeURIComponent(emailAddress.trim()).replace(/%40/gi, "@")}?subject=${encodeURIComponent(`Your ${kind}`)}&body=${encodeURIComponent(emailBody)}`}
              >
                Open email app instead
              </a>
            )}
            {typeof navigator !== "undefined" &&
              typeof navigator.share === "function" && (
                <button
                  type="button"
                  className="btn secondary"
                  onClick={async () => {
                    try {
                      await navigator.share({
                        title: `Your ${kind}`,
                        text: `Hi ${data.name}, here is your ${kind}.`,
                        url,
                      });
                    } catch (e) {
                      if (!(e instanceof Error && e.name === "AbortError"))
                        setMessage("Use Text, Email, or Copy link instead.");
                    }
                  }}
                >
                  Share from phone
                </button>
              )}
            <a
              className="btn secondary"
              href={data.path}
              target="_blank"
              rel="noreferrer"
            >
              Open customer {kind}
            </a>
          </div>
          {canText && data.quietHours && (
            <p className="banner" role="note">
              It’s before 8 AM or after 9 PM where your shop is. Several states
              ban business texts at these hours. Send it in the morning, or use
              email or Copy link.
            </p>
          )}
          {(data.textStoppedOn || data.emailStoppedOn) && (
            <p className="muted">
              {data.name} asked you to stop{" "}
              {[data.textStoppedOn && "texts", data.emailStoppedOn && "emails"]
                .filter(Boolean)
                .join(" and ")}
              . Hand them the link in person or use the other option.
            </p>
          )}
          {!phoneNumber.trim() && !emailAddress.trim() && (
            <p>
              Enter a recipient above, or copy the secure customer link below.
            </p>
          )}
          <details>
            <summary>Copy link instead</summary>
            <label>
              Customer {kind} link
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
              />
            </label>
            <button
              type="button"
              className="btn secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  setMessage("Link copied.");
                } catch {
                  setMessage("Select and copy the link above.");
                }
              }}
            >
              Copy link
            </button>
          </details>
        </section>
      )}
      {needsReplacement && (
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={async () => {
            if (
              !window.confirm(
                "Replace this older sharing link? The previous link will stop working.",
              )
            )
              return;
            setBusy(true);
            try {
              const replacement = await (
                kind === "estimate"
                  ? rotateEstimateLinkAction
                  : rotateInvoiceLinkAction
              )({ id, clientRequestId: crypto.randomUUID() });
              if (replacement.ok) {
                const result = await prepareDocumentShare({ id, kind });
                if (result.ok) {
                  setData(result.data);
                  setEmailAddress(result.data.email ?? "");
                  setPhoneNumber(result.data.phone ?? "");
                  setNeedsReplacement(false);
                  setMessage("");
                } else setMessage(result.message);
              } else setMessage(replacement.error.message);
            } catch {
              setMessage("Could not replace the link.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Replace older link
        </button>
      )}
      {revisionPath && (
        <a className="btn secondary" href={revisionPath}>
          Update estimate
        </a>
      )}
      <p role="status">{message}</p>
    </div>
  );
}
