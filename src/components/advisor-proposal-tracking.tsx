"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { EstimateSnapshot } from "@/db/schema/m3";
import { estimateTotals } from "@/lib/estimate-tax";
import { EstimateDocument, formatMoney } from "./estimate-document";
import { DocumentShare } from "./document-share";

type Event = {
  id: string;
  kind: "document.email_submitted" | "estimate.customer_opened";
  at: string;
  description: string;
};
type Auth = {
  signerName: string;
  createdAt: string;
  approvedLineIds: string[];
} | null;

const dateTime = (value: string, timeZone: string) =>
  new Date(value).toLocaleString("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function AdvisorProposalTracking({
  jobId,
  estimateId,
  shareRequested = false,
  canShare = true,
  version,
  snapshot,
  authorization,
  events,
  documents,
  customerPath,
  timeZone,
}: {
  jobId: string;
  estimateId: string;
  shareRequested?: boolean;
  canShare?: boolean;
  version: number;
  snapshot: EstimateSnapshot;
  authorization: Auth;
  events: Event[];
  documents: ReactNode;
  customerPath?: string;
  timeZone: string;
}) {
  const [tab, setTab] = useState<"activity" | "decisions" | "documents">("activity");
  const [preview, setPreview] = useState(false);
  const [sendOpen, setSendOpen] = useState(shareRequested || !events.some((e) => e.kind === "document.email_submitted"));
  const opened = events.find((e) => e.kind === "estimate.customer_opened");
  const submitted = events.find((e) => e.kind === "document.email_submitted");
  const signed = Boolean(authorization);
  const ids = new Set(authorization?.approvedLineIds ?? []);
  const approved = snapshot.lines.filter((line) => ids.has(line.id));
  const declined = authorization
    ? snapshot.lines.filter((line) => !ids.has(line.id))
    : [];
  const approvedTotal = estimateTotals(approved, snapshot.taxBps).totalCents;
  const heading = signed
    ? "Signed · customer decisions recorded"
    : opened
      ? "Opened · awaiting customer authorization"
      : submitted
        ? "Email submitted · not yet opened"
        : "Prepared · not sent";
  const timeline = [
    ...(authorization
      ? [{
          id: "signed",
          title: "Customer authorization signed",
          at: authorization.createdAt,
          details: `Signed by ${authorization.signerName}. ${approved.length} line(s) approved; ${declined.length} declined.`,
        }]
      : []),
    ...events.map((e) => ({
      id: e.id,
      title: e.kind === "estimate.customer_opened"
        ? "Customer proposal page opened"
        : "Proposal email submitted",
      at: e.at,
      details: e.description,
    })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return (
    <section className="proposal-tracker" aria-label="Customer proposal tracking">
      <header className="proposal-tracker-heading">
        <div>
          <p className="muted proposal-eyebrow">CUSTOMER PROPOSAL · VERSION {version}</p>
          <h2>Proposal &amp; Customer Activity</h2>
          <p className="muted">{snapshot.customerName} · {snapshot.serviceLabel || snapshot.vehicleLabel}</p>
        </div>
        <span className={`proposal-status ${signed ? "is-signed" : opened ? "is-opened" : ""}`}>
          {signed ? "Signed" : opened ? "Opened" : submitted ? "Submitted" : "Not sent"}
        </span>
      </header>

      <div className="proposal-tracker-summary">
        <div>
          <p className="muted">PROPOSAL TOTAL</p>
          <strong>{formatMoney(snapshot.totalCents)}</strong>
        </div>
        <div>
          <p className="muted">AUTHORIZED TOTAL</p>
          <strong>{signed ? formatMoney(approvedTotal) : "Pending signature"}</strong>
        </div>
        <p className="proposal-heading-status">{heading}</p>
        <div className="proposal-tracker-metrics">
          <div><span>Sent</span><strong>{submitted ? dateTime(submitted.at, timeZone) : "Not submitted"}</strong></div>
          <div><span>Delivered</span><strong>Not confirmed</strong></div>
          <div><span>Opened</span><strong>{opened ? dateTime(opened.at, timeZone) : "Not recorded"}</strong></div>
          <div><span>Signed</span><strong>{authorization ? dateTime(authorization.createdAt, timeZone) : "Pending"}</strong></div>
        </div>
        <p className="muted proposal-clarifier">
          Email submitted means the provider accepted the message, not that it was delivered.
          Opened means the secure proposal page loaded; it does not prove the customer read it.
        </p>
      </div>

      {!signed && canShare && (
        <section className="proposal-send-stage" id="proposal-send" aria-label="Send customer proposal">
          <div className="proposal-send-stage-head">
            <div>
              <p className="muted">{submitted ? "STEP 3 OF 4 · SHARED" : "STEP 3 OF 4 · SEND"}</p>
              <h3>{submitted ? "Customer response pending" : "Send proposal for approval"}</h3>
              <p>{submitted
                ? "The proposal email was submitted. You can send it again, preview the customer page, or check activity below."
                : "Confirm the recipient and send the secure inspection and authorization link. We will track when the page is opened and signed."}</p>
            </div>
            <button type="button" className="btn secondary" onClick={() => setSendOpen((open) => !open)} aria-expanded={sendOpen}>
              {sendOpen ? "Hide sending" : submitted ? "Resend / share" : "Send proposal"}
            </button>
          </div>
          {sendOpen && <DocumentShare id={estimateId} kind="estimate" autoOpen />}
        </section>
      )}
      {signed && (
        <div className="proposal-signed-next">
          <strong>Customer authorization received.</strong>
          <p>Only approved repairs may be released to the assigned technician. Continue on the RO's Overview.</p>
          <Link className="btn primary" href={`/app/jobs?job=${jobId}#ro-workflow`}>Review approved work</Link>
        </div>
      )}

      <div className="proposal-tracker-actions">
        <button
          type="button"
          className="btn secondary"
          onClick={() => setPreview((current) => !current)}
          aria-expanded={preview}
        >
          {preview ? "Hide customer preview" : "Preview estimate"}
        </button>
        {customerPath && (
          <a
            className="btn secondary"
            href={`${customerPath}${customerPath.includes("?") ? "&" : "?"}advisor_preview=1`}
            target="_blank"
            rel="noreferrer"
          >
            Open exact customer page
          </a>
        )}
        <Link className="btn secondary" href={`/app/jobs?job=${jobId}&tab=files`}>
          All RO documents
        </Link>
      </div>

      {preview && (
        <div className="proposal-customer-preview">
          <p className="muted">READ-ONLY CUSTOMER PREVIEW · NO APPROVAL RECORDED</p>
          <EstimateDocument snapshot={snapshot} />
          <p className="muted">
            This preview uses the exact saved estimate version, prices and terms.
            Open the customer page to inspect its interactive signature steps and media.
          </p>
        </div>
      )}

      <nav className="proposal-tracker-tabs" aria-label="Proposal details">
        {(["activity", "decisions", "documents"] as const).map((name) => (
          <button
            key={name}
            type="button"
            className={tab === name ? "is-active" : ""}
            aria-current={tab === name ? "page" : undefined}
            onClick={() => setTab(name)}
          >
            {name === "activity" ? "Activity" : name === "decisions" ? "Decisions" : "Documents"}
          </button>
        ))}
      </nav>
      {tab === "activity" && (
        <section className="proposal-activity" aria-label="Proposal activity">
          <h3>Customer activity</h3>
          {!signed && (
            <p className="muted">
              Customer selections are not final until signed. This page does not
              imply work is approved merely because the customer opened a link.
            </p>
          )}
          {timeline.length ? (
            <ol className="proposal-timeline">
              {timeline.map((event) => (
                <li key={event.id}>
                  <strong>{event.title}</strong>
                  <time dateTime={event.at}>{dateTime(event.at, timeZone)}</time>
                  <p className="muted">{event.details}</p>
                </li>
              ))}
            </ol>
          ) : <p className="muted">No customer delivery, opening, or authorization events recorded for this version yet.</p>}
          {!signed && canShare && (
            <button type="button" className="btn secondary" onClick={() => { setSendOpen(true); document.getElementById("proposal-send")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
              {submitted ? "Resend proposal" : "Send customer proposal"}
            </button>
          )}
        </section>
      )}
      {tab === "decisions" && (
        <section className="proposal-decisions" aria-label="Customer repair decisions">
          <h3>Repair decisions</h3>
          {!signed && <p className="muted">Awaiting signed authorization. No line items can be released to the technician yet.</p>}
          {snapshot.lines.map((line) => (
            <div className="proposal-decision" key={line.id}>
              <div>
                <strong>{line.description}</strong>
                <p className="muted">{line.kind === "part" ? "Part" : "Labor"} · Qty {line.quantity}</p>
              </div>
              <div className="proposal-decision-right">
                <strong>{formatMoney(line.totalCents)}</strong>
                <span className={authorization ? ids.has(line.id) ? "is-approved" : "is-declined" : "is-pending"}>
                  {authorization ? ids.has(line.id) ? "Approved" : "Declined" : "Awaiting signature"}
                </span>
              </div>
            </div>
          ))}
          {authorization && <p className="proposal-approved-total">Customer-authorized total: {formatMoney(approvedTotal)}</p>}
        </section>
      )}
      {tab === "documents" && (
        <div className="proposal-documents" aria-label="Documents sent and signed">
          {documents}
        </div>
      )}
    </section>
  );
}
