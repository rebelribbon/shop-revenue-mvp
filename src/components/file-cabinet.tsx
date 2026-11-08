"use client";

import { useEffect, useMemo, useState } from "react";
import type { CabinetItem } from "@/domain/documents";
import { prepareDocumentShare } from "@/server/actions/document-sharing";
import {
  removeDocumentAction,
  voidDocumentAction,
} from "@/server/actions/documents";
import { ActionForm } from "./action-form";
import { DocumentShare } from "./document-share";

type View = "all" | "generated" | "uploaded";

export function FileCabinet({
  items,
  readOnly,
  demoMode = false,
  autoOpenShare = false,
  timeZone,
}: {
  items: CabinetItem[];
  customerPhone: string | null;
  customerEmail: string | null;
  readOnly: boolean;
  demoMode?: boolean;
  autoOpenShare?: boolean;
  timeZone: string;
}) {
  const estimate = items.find((item) => item.estimateShareId);
  const [view, setView] = useState<View>("all");
  const [activeId, setActiveId] = useState<string>(
    estimate?.id ?? items[0]?.id ?? "",
  );
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [shareOpen, setShareOpen] = useState(autoOpenShare);
  const [estimatePreview, setEstimatePreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState("");
  const active = items.find((item) => item.id === activeId) ?? items[0];
  const eligible = items.filter(
    (item) => (item.signLink || (demoMode && item.preview?.type === "agreement")) && item.documentId && item.status === "Prepared",
  );
  const selectedDocuments = eligible
    .filter((item) => checkedIds.includes(item.documentId!))
    .map((item) => item.documentId!);
  const docs = useMemo(
    () =>
      items.filter((item) =>
        view === "uploaded"
          ? item.group === "Added files"
          : view === "generated"
            ? item.group !== "Added files"
            : true,
      ),
    [items, view],
  );
  const previewPath =
    active?.signLink ??
    (active?.estimateShareId ? estimatePreview : null) ??
    active?.href ??
    null;
  const money = (cents: number) => new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
  }).format(cents / 100);
  const date = (d: Date) =>
    new Date(d).toLocaleDateString("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  useEffect(() => {
    if (!active?.estimateShareId) return;
    let live = true;
    const id = active.estimateShareId;
    void prepareDocumentShare({ id, kind: "estimate" })
      .then((result) => {
        if (!live) return;
        if (result.ok) {
          setEstimatePreview(result.data.path);
          setPreviewError("");
        } else {
          setEstimatePreview(null);
          setPreviewError(result.message);
        }
      })
      .catch(() => {
        if (live) setPreviewError("Preview unavailable. Try again.");
      });
    return () => {
      live = false;
    };
  }, [active?.estimateShareId]);

  return (
    <section
      className="docs-workspace"
      id="file-cabinet"
      aria-label="Documents and customer packet"
    >
      <header className="docs-toolbar">
        <div>
          <h3>
            Documents <span className="docs-counter">{items.length}</span>
          </h3>
          <p className="muted">
            Select a document to preview. Tick agreements to include in the
            customer packet.
          </p>
        </div>
        <div className="docs-toolbar-actions">
          <button
            type="button"
            className="btn secondary"
            disabled={!previewPath}
            onClick={() => {
              if (previewPath)
                window.open(previewPath, "_blank", "noopener,noreferrer");
            }}
          >
            Open preview
          </button>
          {(!readOnly || demoMode) && (
            <button
              type="button"
              className="btn primary"
              disabled={!estimate?.estimateShareId && !demoMode}
              onClick={() => setShareOpen((open) => !open)}
              aria-expanded={shareOpen}
              aria-controls="docs-share-panel"
            >
              {shareOpen ? "Close share" : "Share packet"}
            </button>
          )}
        </div>
      </header>

      {shareOpen && (estimate?.estimateShareId || demoMode) && (
        <section
          id="docs-share-panel"
          className="docs-share-panel"
          aria-label="Share customer documents"
        >
          <div className="docs-share-heading">
            <div>
              <h4>Share with customer</h4>
              <p className="muted">
                {1 + selectedDocuments.length} document
                {selectedDocuments.length ? "s" : ""} in this packet · Review
                recipients and send
              </p>
            </div>
            <button
              className="btn secondary"
              type="button"
              onClick={() => setShareOpen(false)}
            >
              Close
            </button>
          </div>
          {demoMode ? (
            <div className="docs-demo-composer">
              <p><strong>Recipient</strong></p>
              <input aria-label="Demo customer email" type="email" placeholder="customer@example.com" />
              <p className="muted">The real Share action sends one customer link for the estimate and selected agreements.</p>
              <button type="button" className="btn primary" disabled>Send (disabled in public preview)</button>
            </div>
          ) : estimate?.estimateShareId ? (
            <DocumentShare
              id={estimate.estimateShareId}
              kind="estimate"
              primary
              autoOpen
              selectedDocumentIds={selectedDocuments}
            />
          ) : null}
        </section>
      )}

      <div className="docs-tabs" role="group" aria-label="Document types">
        <button
          type="button"
          className={view === "all" ? "is-active" : ""}
          onClick={() => setView("all")}
        >
          All ({items.length})
        </button>
        <button
          type="button"
          className={view === "generated" ? "is-active" : ""}
          onClick={() => setView("generated")}
        >
          Generated (
          {items.filter((item) => item.group !== "Added files").length})
        </button>
        <button
          type="button"
          className={view === "uploaded" ? "is-active" : ""}
          onClick={() => setView("uploaded")}
        >
          Uploaded (
          {items.filter((item) => item.group === "Added files").length})
        </button>
      </div>

      <div className="docs-split">
        <div className="docs-list" role="list" aria-label="Documents">
          <div className="docs-list-heading">
            <span>Document</span>
            <span>Status</span>
          </div>
          {docs.length === 0 && (
            <div className="docs-empty">
              No documents here yet. Prepare an estimate or add an agreement
              from the job&apos;s Docs section.
            </div>
          )}
          {docs.map((item) => {
            const selectable = Boolean(
              item.documentId && (item.signLink || (demoMode && item.preview?.type === "agreement")) && item.status === "Prepared",
            );
            return (
              <div
                className={`docs-list-row ${active?.id === item.id ? "is-selected" : ""}`}
                key={item.id}
                role="listitem"
              >
                <div className="docs-row-first">
                  {selectable && !readOnly ? (
                    <input
                      type="checkbox"
                      aria-label={`Include ${item.title} in packet`}
                      checked={checkedIds.includes(item.documentId!)}
                      onChange={(event) =>
                        setCheckedIds((ids) =>
                          event.target.checked
                            ? [...ids, item.documentId!]
                            : ids.filter((id) => id !== item.documentId),
                        )
                      }
                    />
                  ) : (
                    <span className="docs-row-icon" aria-hidden="true">
                      ▤
                    </span>
                  )}
                  <button
                    type="button"
                    className="docs-doc-select"
                    onClick={() => setActiveId(item.id)}
                    aria-current={active?.id === item.id ? "true" : undefined}
                  >
                    <strong>{item.title}</strong>
                    <small>
                      {item.detail} · {date(item.at)}
                    </small>
                  </button>
                </div>
                <span
                  className={`docs-status ${item.status === "Signed" ? "is-done" : ""}`}
                >
                  {item.status || "Filed"}
                </span>
              </div>
            );
          })}
        </div>

        <aside className="docs-preview-pane" aria-label="Document preview">
          {active ? (
            <>
              <div className="docs-preview-head">
                <div>
                  <strong>{active.title}</strong>
                  <small>{active.status || "Filed"}</small>
                </div>
                {previewPath && (
                  <a href={previewPath} target="_blank" rel="noreferrer">
                    Full preview
                  </a>
                )}
              </div>
              {active.preview ? (
                <article className="docs-paper" aria-label={`Document content: ${active.title}`}>
                  <div className="docs-paper-heading">
                    <small>SHOP REVENUE · CUSTOMER DOCUMENT</small>
                    <h4>{active.title}</h4>
                    {active.preview.shopName && <strong>{active.preview.shopName}</strong>}
                    {active.preview.customerName && <p>Prepared for {active.preview.customerName}</p>}
                    {active.preview.subject && <p>{active.preview.subject}</p>}
                  </div>
                  {active.preview.type === "estimate" && (
                    <>
                      <table className="docs-paper-lines">
                        <thead><tr><th scope="col">Work / item</th><th scope="col">Qty</th><th scope="col">Amount</th></tr></thead>
                        <tbody>
                          {(active.preview.lines ?? []).map((line) => (
                            <tr key={line.id}>
                              <td>{line.description}</td>
                              <td>{line.quantity}</td>
                              <td>{money(line.totalCents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="docs-paper-totals">
                        <span>Tax</span><span>{money(active.preview.taxCents ?? 0)}</span>
                        <strong>Estimated total</strong><strong>{money(active.preview.totalCents ?? 0)}</strong>
                      </div>
                      <p className="docs-paper-note">Customer approves or declines each priced item and signs the authorization. Amounts cannot be changed by the customer.</p>
                    </>
                  )}
                  {active.preview.type === "agreement" && (
                    <>
                      <div className="docs-paper-body">{active.preview.body}</div>
                      {(active.preview.fields ?? []).length > 0 && (
                        <div className="docs-paper-fields">
                          {(active.preview.fields ?? []).map((field, idx) => (
                            <div key={idx}><span>{field.label}</span><span className="docs-paper-blank">{field.type === "checkbox" ? "☐" : "________________"}</span></div>
                          ))}
                        </div>
                      )}
                      <div className="docs-paper-sign"><span>Customer signature</span><span>________________________________</span></div>
                    </>
                  )}
                  {active.preview.type === "invoice" && (
                    <div className="docs-paper-totals">
                      <strong>Invoice total</strong><strong>{money(active.preview.totalCents ?? 0)}</strong>
                    </div>
                  )}
                  <div className="docs-paper-footer">Read-only preview · No approval, signature, or payment is recorded here.</div>
                </article>
              ) : (
                <div className="docs-preview-placeholder">
                  <span className="docs-preview-glyph" aria-hidden="true">▤</span>
                  <h4>{active.title}</h4>
                  <p>{previewError && active.estimateShareId ? previewError : "Use Full preview to view this attachment or signed copy."}</p>
                  {previewPath && <a className="btn secondary" href={previewPath} target="_blank" rel="noreferrer">Open document</a>}
                </div>
              )}
              {active.signLink && !readOnly && (
                <div className="docs-preview-foot">
                  <span className="muted">Customer signature requested</span>
                  <ActionForm
                    action={voidDocumentAction}
                    hidden={{ documentId: active.documentId! }}
                    submitLabel="Void document"
                    variant="danger"
                    confirm="Void this document? The customer's link stops working."
                  />
                </div>
              )}
              {active.group === "Added files" &&
                active.documentId &&
                !readOnly && (
                  <div className="docs-preview-foot">
                    <ActionForm
                      action={removeDocumentAction}
                      hidden={{ documentId: active.documentId }}
                      submitLabel="Remove file"
                      variant="danger"
                      confirm={`Remove ${active.title}?`}
                    />
                  </div>
                )}
            </>
          ) : (
            <div className="docs-preview-placeholder">
              <h4>No documents yet</h4>
              <p>
                Prepare the estimate from the Job Setup view and it will appear
                here automatically.
              </p>
            </div>
          )}
        </aside>
      </div>
      <p className="docs-footnote">
        Shop pricing and document content are fixed before sharing. Customer
        signatures and signed copies stay attached to this job.
      </p>
    </section>
  );
}
