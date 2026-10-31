import { RefreshJobStatus } from "./refresh-job-status";
import Link from "next/link";
import {
  type JobWorkflow as Workflow,
  stageLabels,
} from "@/domain/job-workflow";
import {
  recordJobProgressAction,
  recordJobSharingAction,
} from "@/server/actions/job-workflow";
import { ActionForm } from "./action-form";
import { EstimateLink } from "./estimate-publisher";
import { InvoiceLink } from "./invoice-controls";
import { formatMoney } from "./estimate-document";

export function WorkflowBadges({ flow }: { flow: Workflow }) {
  return (
    <div className="workflow-status" aria-label="Job status">
      <span>
        <strong>Customer</strong> {flow.approval}
      </span>
      <span>
        <strong>Work</strong>{" "}
        {flow.work === "completed"
          ? "Complete"
          : flow.work === "in_progress"
            ? "In progress"
            : "Not recorded"}
      </span>
      <span>
        <strong>Payment</strong>{" "}
        {!flow.currentInvoice
          ? "No active invoice"
          : flow.currentInvoice.disputeOpen
            ? "Dispute open"
            : flow.refundPending
              ? "Refund pending"
              : flow.balanceCents === 0
                ? "Paid"
                : flow.processing
                  ? "Not confirmed — checkout open / processing"
                  : flow.paidCents > 0
                    ? `Partially paid · ${formatMoney(flow.balanceCents)} due`
                    : `Unpaid · ${formatMoney(flow.balanceCents)} due`}
      </span>
    </div>
  );
}

export function JobWorkflow({
  flow,
  jobId,
  timezone,
  readOnly,
}: {
  flow: Workflow;
  jobId: string;
  timezone: string;
  readOnly: boolean;
}) {
  const e = flow.latest?.estimate,
    a = flow.latest?.authorization,
    i = flow.currentInvoice;
  const progress = (status: "in_progress" | "completed", label: string) =>
    !readOnly &&
    e && (
      <ActionForm
        action={recordJobProgressAction}
        variant="primary"
        hidden={{
          jobId,
          versionId: e.id,
          expectedStatus: flow.work,
          status,
          note: "",
        }}
        submitLabel={label}
      />
    );
  return (
    <section className="job-workflow" aria-label="Job workflow">
      <h3>{stageLabels[flow.stage]}</h3>
      <WorkflowBadges flow={flow} />
      <ol className="workflow-milestones" aria-label="Job lifecycle">
        {[
          { label: "Estimate", done: !!e },
          { label: "Decision", done: !!a },
          { label: "Work", done: flow.work === "completed" },
          { label: "Invoice", done: !!i },
          {
            label: "Payment",
            done:
              !!i &&
              flow.balanceCents === 0 &&
              !flow.refundPending &&
              !i.disputeOpen,
          },
        ].map((step) => (
          <li key={step.label}>
            <strong>{step.label}</strong>
            <span>{step.done ? "Recorded" : "Pending"}</span>
          </li>
        ))}
      </ol>
      <section className="workflow-next" aria-label="Next step">
        <h4>Next step</h4>
        {flow.stage === "draft" ? (
          <p>
            Review parts and labor, then publish the customer estimate below. A
            draft is not customer authorization.
          </p>
        ) : flow.stage === "awaiting" ? (
          <>
            <p>
              {e?.revokedAt || (e && e.expiresAt <= new Date())
                ? "Renew the customer link from estimate history before requesting a decision."
                : "Share the estimate link yourself, then refresh to check the customer's decision. Publishing does not send a message or charge a card."}
            </p>
            <RefreshJobStatus />
          </>
        ) : flow.stage === "declined" ? (
          <>
            <p>
              The customer authorized no work on this version. Revise the scope
              and request a fresh decision.
            </p>
            <Link
              className="btn primary"
              data-page-primary
              href={`/app/jobs?edit=${jobId}`}
            >
              Revise job / estimate
            </Link>
          </>
        ) : flow.stage === "ready" ? (
          <>
            <p>
              The customer authorized the items below. Record when that work
              starts. An issued or paid invoice does not mark the repair
              complete.
            </p>
            {progress("in_progress", "Start authorized work")}
          </>
        ) : flow.stage === "working" ? (
          <>
            <p>
              Complete only the authorized items below, record actual labor
              hours, then mark the work finished.
            </p>
            <Link href={`/app/jobs?edit=${jobId}`}>
              Record actual labor hours
            </Link>
            {progress("completed", "Mark authorized work complete")}
          </>
        ) : flow.stage === "bill" ? (
          <>
            <p>
              Work is marked complete. Create the invoice for the authorized
              items; this requests payment and does not collect money.
            </p>
            <Link
              className="btn primary"
              data-page-primary
              href={`/app/invoices?new=1&versionId=${e?.id}`}
            >
              Create invoice for completed work
            </Link>
          </>
        ) : (
          <>
            <p>
              {flow.stage === "attention"
                ? "A dispute, refund or balance adjustment needs review. Open the invoice for its confirmed ledger and pending actions."
                : flow.stage === "paid"
                  ? "Work is complete and the invoice ledger shows the full payment. Bank payout timing is separate from the customer's payment."
                  : flow.processing
                    ? "An online checkout is open or processing. Payment is not confirmed until the invoice ledger updates. Check its payment status before taking another payment."
                    : "Share the invoice link, then check the confirmed payment history. Record cash or other external payments only after receiving them."}
            </p>
            <Link
              className="btn primary"
              data-page-primary
              href={`/app/invoices?invoiceId=${i?.id}`}
            >
              {flow.stage === "paid"
                ? "View paid invoice & receipt"
                : "Open invoice & payment status"}
            </Link>
          </>
        )}
      </section>
      {e && (
        <section className="record-details">
          <h4>Customer decision · estimate v{e.version}</h4>
          {a ? (
            <>
              <p>
                <strong>{flow.approval}</strong> · Signed by {a.signerName} ·{" "}
                {a.createdAt.toLocaleString("en-US", { timeZone: timezone })}
              </p>
              <h4>Authorized work</h4>
              {!flow.approved.length ? (
                <p>No work authorized.</p>
              ) : (
                <ul className="authorized-work">
                  {flow.approved.map((line) => (
                    <li key={line.id}>
                      <strong>{line.description}</strong> · {line.quantity}{" "}
                      {line.kind === "labor" ? "quoted hours" : "units"} ·{" "}
                      {formatMoney(line.totalCents)}
                    </li>
                  ))}
                </ul>
              )}
              {!!flow.declined.length && (
                <>
                  <h4>Declined — do not perform</h4>
                  <ul>
                    {flow.declined.map((line) => (
                      <li key={line.id}>
                        {line.description} · {formatMoney(line.totalCents)}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : (
            <p>
              No customer signature on this version. Do not treat it as
              approval.
            </p>
          )}
          <p className="muted">
            Work status applies to this estimate version. Earlier decisions and
            work remain in the timeline.
          </p>
          <details open={!a}>
            <summary>Customer estimate &amp; sharing</summary>
            <p>
              The customer sees this version’s itemized prices and can authorize
              or decline items. Internal costs stay private. Sharing is manual.
            </p>
            <p>
              {flow.sharedEstimate
                ? "Link sharing recorded by the shop."
                : "Sharing has not been recorded. A link may still have been shared outside this app."}
            </p>
            {!readOnly && !e.revokedAt && (
              <>
                <EstimateLink id={e.id} />
                <ActionForm
                  action={recordJobSharingAction}
                  hidden={{ jobId, documentId: e.id, kind: "estimate" }}
                  submitLabel="Mark estimate link shared"
                  variant="secondary"
                />
              </>
            )}
            <Link href={`/app/estimates?jobId=${jobId}`}>
              Full estimate &amp; signature history
            </Link>
          </details>
        </section>
      )}
      {i && (
        <section className="record-details">
          <h4>Invoice #{i.number} &amp; money</h4>
          <p>
            Total {formatMoney(i.totalCents)} · Confirmed / recorded{" "}
            {formatMoney(flow.paidCents)} ·{" "}
            <strong>Balance {formatMoney(flow.balanceCents)}</strong>
          </p>
          <p>
            Issuing or sharing this invoice does not charge a card. Online
            payments appear after verification; external payments are entered by
            the shop.
          </p>
          {flow.work !== "completed" && (
            <p className="notice">
              This invoice exists, but completion of the current authorized work
              has not been recorded.
            </p>
          )}
          {i.disputeOpen && (
            <p className="notice">Open dispute: {i.disputeOpen}</p>
          )}
          {flow.refundPending && (
            <p className="notice">
              A refund is pending. The balance changes only after its ledger
              entry is confirmed.
            </p>
          )}
          <Link href={`/app/invoices?invoiceId=${i.id}`}>
            Payment history, refunds &amp; receipt
          </Link>
          <details>
            <summary>Customer invoice &amp; sharing</summary>
            <p>
              The customer sees the authorized billable items, total, payment
              history and balance. They choose whether to open card checkout.
            </p>
            <p>
              {flow.sharedInvoice
                ? "Link sharing recorded by the shop."
                : "Invoice sharing has not been recorded."}
            </p>
            {!readOnly && (
              <>
                <InvoiceLink id={i.id} />
                <ActionForm
                  action={recordJobSharingAction}
                  hidden={{ jobId, documentId: i.id, kind: "invoice" }}
                  submitLabel="Mark invoice link shared"
                  variant="secondary"
                />
              </>
            )}
          </details>
        </section>
      )}
      {flow.work === "completed" &&
        !readOnly &&
        e &&
        !!flow.approved.length && (
          <details>
            <summary>Reopen unfinished work</summary>
            <ActionForm
              action={recordJobProgressAction}
              variant="secondary"
              hidden={{
                jobId,
                versionId: e.id,
                expectedStatus: flow.work,
                status: "in_progress",
              }}
              submitLabel="Reopen work"
            >
              <label htmlFor={`reopen-${jobId}`}>Reason</label>
              <input
                id={`reopen-${jobId}`}
                name="note"
                required
                maxLength={1000}
              />
            </ActionForm>
          </details>
        )}
      <section className="record-details">
        <h4>Job timeline · estimate to payment</h4>
        <p className="muted">
          Recorded times shown in {timezone}. Sharing entries are shop
          confirmations, not delivery receipts.
        </p>
        <ol className="workflow-timeline">
          {flow.timeline.map((event) => (
            <li key={event.id}>
              <strong>{event.text}</strong>
              <time dateTime={event.at.toISOString()}>
                {event.at.toLocaleString("en-US", { timeZone: timezone })}
              </time>
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}
