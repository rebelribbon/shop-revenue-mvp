"use client";
import { rotateEstimateLinkAction } from "@/server/actions/estimates";
import { rotateInvoiceLinkAction } from "@/server/actions/invoices";
import { useState } from "react";
import { prepareDocumentShare } from "@/server/actions/document-sharing";
export function DocumentShare({
  id,
  kind,
  primary = false,
  label,
  initial,
}: {
  id: string;
  kind: "estimate" | "invoice";
  primary?: boolean;
  label?: string;
  initial?: {
    path: string;
    name: string;
    phone: string | null;
    email: string | null;
  };
}) {
  const [data, setData] = useState<{
      path: string;
      name: string;
      phone: string | null;
      email: string | null;
    } | null>(initial ?? null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [needsReplacement, setNeedsReplacement] = useState(false),
    [revisionPath, setRevisionPath] = useState<string | undefined>();
  const url = data ? new URL(data.path, window.location.origin).href : "";
  const body = `Hi ${data?.name ?? ""}, here is your ${kind}: ${url}`;
  const ios =
    typeof navigator !== "undefined" &&
    (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  return (
    <div className="document-sharing">
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
              if (r.ok) setData(r.data);
              else {
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
          <h4>
            Send {kind} to {data.name}
          </h4>
          <p>Choose Text or Email, then tap Send in your own app.</p>
          <div className="money-actions">
            {data.phone && (
              <a
                className={`btn ${primary ? "primary" : "secondary"}`}
                data-page-primary={primary ? true : undefined}
                href={`sms:${data.phone}${ios ? "&" : "?"}body=${encodeURIComponent(body)}`}
              >
                Text to customer
              </a>
            )}
            {data.email && (
              <a
                className={`btn ${primary && !data.phone ? "primary" : "secondary"}`}
                data-page-primary={primary && !data.phone ? true : undefined}
                href={`mailto:${data.email}?subject=${encodeURIComponent(`Your ${kind}`)}&body=${encodeURIComponent(body)}`}
              >
                Email to customer
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
          {!data.phone && !data.email && (
            <p>
              Add a phone number or email on the customer record, or copy the
              link below.
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
