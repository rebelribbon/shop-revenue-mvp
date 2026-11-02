import Link from "next/link";
import type { JobWorkflow as Workflow } from "@/domain/job-workflow";
import {
  recordJobProgressAction,
  recordJobSharingAction,
} from "@/server/actions/job-workflow";
import { ActionForm } from "./action-form";
import { DocumentShare } from "./document-share";
import { RefreshJobStatus } from "./refresh-job-status";
import { formatMoney } from "./estimate-document";
import { estimateTotals } from "@/lib/estimate-tax";
import {
  billPlanNowAction,
  setServicePlanStatusAction,
  startServicePlanAction,
} from "@/server/actions/service-plans";
import type { PlanSummary } from "@/domain/service-plans";
import {
  cadenceText,
  formatPlanDate,
  untilText,
  visitsPerMonth,
} from "@/lib/service-plans";

function PlanPanel({
  plan,
  timezone,
  readOnly,
}: {
  plan: PlanSummary;
  timezone: string;
  readOnly: boolean;
}) {
  const r = plan.repeat;
  const status =
    plan.status === "active"
      ? "Running"
      : plan.status === "paused"
        ? "Paused"
        : "Ended";
  return (
    <div className="plan-summary" data-plan-status={plan.status}>
      <p>
        <span className="plan-badge">↻ {status}</span>
      </p>
      <p>
        <strong>{cadenceText(r)}</strong>, {untilText(r)}.{" "}
        {r.billing === "per_visit"
          ? "An invoice is made when you mark each visit done."
          : "Finished visits are billed together on the 1st of each month."}
      </p>
      <ul>
        <li>
          {plan.done} done · {plan.skipped} skipped ·{" "}
          {formatMoney(plan.billedCents)} billed so far
        </li>
        {plan.status === "active" && (
          <li>
            Worth about{" "}
            {formatMoney(
              Math.round(plan.perVisitCents * visitsPerMonth(r.every)),
            )}{" "}
            a month
          </li>
        )}
        {plan.unbilled > 0 && (
          <li>
            {plan.unbilled} finished visit{plan.unbilled === 1 ? "" : "s"} not
            billed yet
          </li>
        )}
        {plan.endReason && <li>Ended: {plan.endReason}</li>}
      </ul>
      {plan.next.length > 0 && (
        <>
          <h4>Coming up</h4>
          <ul>
            {plan.next.map((v) => (
              <li key={v.id}>
                {v.startsAt.toLocaleString("en-US", {
                  timeZone: timezone,
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </li>
            ))}
          </ul>
          <Link href="/app/schedule">Open Visits to mark them done</Link>
        </>
      )}
      {plan.status === "paused" && plan.pausedAt && (
        <p>
          Paused since{" "}
          {formatPlanDate(plan.pausedAt.toISOString().slice(0, 10))}.
        </p>
      )}
      {!readOnly && (
        <>
          {plan.unbilled > 0 && (
            <ActionForm
              action={billPlanNowAction}
              hidden={{ planId: plan.id }}
              submitLabel="Bill finished visits now"
              variant={plan.status === "active" ? "secondary" : "primary"}
            />
          )}
          {plan.status === "active" && (
            <ActionForm
              action={setServicePlanStatusAction}
              hidden={{ planId: plan.id, action: "pause" }}
              submitLabel="Pause plan (e.g. for winter)"
              variant="secondary"
            />
          )}
          {plan.status === "paused" && (
            <ActionForm
              action={setServicePlanStatusAction}
              hidden={{ planId: plan.id, action: "resume" }}
              submitLabel="Resume plan"
              variant="primary"
            />
          )}
          {plan.status !== "ended" && (
            <details>
              <summary>End this plan</summary>
              <ActionForm
                action={setServicePlanStatusAction}
                hidden={{ planId: plan.id, action: "end" }}
                submitLabel="End plan"
                variant="danger"
                confirm="End this plan? Upcoming visits come off the calendar. Finished visits and invoices are kept."
              >
                <label htmlFor={`end-reason-${plan.id}`}>
                  Reason (optional)
                </label>
                <input
                  id={`end-reason-${plan.id}`}
                  name="reason"
                  maxLength={300}
                />
              </ActionForm>
            </details>
          )}
        </>
      )}
    </div>
  );
}
export function WorkflowBadges({ flow }: { flow: Workflow }) {
  return (
    <p className="muted" aria-label="Job balance">
      {flow.currentInvoice
        ? flow.balanceCents === 0
          ? "Paid"
          : `${flow.paidCents > 0 ? "Partially paid · " : ""}${formatMoney(flow.balanceCents)} unpaid`
        : flow.latest
          ? formatMoney(flow.latest.estimate.snapshot.totalCents)
          : "Estimate needed"}
    </p>
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
  const approvedTotal = e
    ? estimateTotals(flow.approved, e.snapshot.taxBps).totalCents
    : 0;
  const headline =
    flow.stage === "awaiting" && e && new Date(e.expiresAt) <= new Date()
      ? `Estimate link expired. Send ${e.snapshot.customerName} a new one.`
      : flow.stage === "awaiting"
        ? `Waiting on ${e?.snapshot.customerName} to approve: ${formatMoney(e?.snapshot.totalCents ?? 0)}`
        : flow.stage === "ready" && flow.repeats
          ? `${e?.snapshot.customerName} approved ${formatMoney(approvedTotal)} a visit`
          : flow.stage === "plan" && flow.plan
            ? `Service plan running: ${formatMoney(flow.plan.perVisitCents)} a visit`
            : flow.stage === "plan_paused"
              ? "Service plan paused"
              : flow.stage === "plan_ended"
                ? "Service plan ended"
                : flow.stage === "ready"
                  ? `${e?.snapshot.customerName} approved ${formatMoney(approvedTotal)}`
                  : flow.stage === "working"
                    ? `Work in progress: ${formatMoney(approvedTotal)}`
                    : flow.stage === "bill"
                      ? `Work finished: ${formatMoney(approvedTotal)} to bill`
                      : flow.stage === "paid"
                        ? `Paid in full: ${formatMoney(flow.paidCents)}`
                        : flow.stage === "payment"
                          ? `${flow.paidCents > 0 ? "Partially paid" : "Waiting on payment"}: ${formatMoney(flow.balanceCents)} left`
                          : flow.stage === "declined"
                            ? "The customer declined this work."
                            : flow.stage === "attention"
                              ? "This payment needs a look."
                              : "Estimate not sent yet";
  const progress = (status: "in_progress" | "completed", label: string) =>
    !readOnly && e ? (
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
    ) : null;
  return (
    <section
      className="job-workflow"
      aria-label="Job workflow"
      data-stage={flow.stage}
    >
      <h3>{headline}</h3>
      {flow.changedSinceEstimate && e && !i && (
        <div className="notice banner" role="status">
          <p>
            {a
              ? `You changed this job after ${e.snapshot.customerName} approved it. They haven’t approved the changes, and an invoice will only bill what they approved.`
              : `You changed this job after sending the estimate. ${e.snapshot.customerName} is still seeing the old prices.`}
          </p>
          {!readOnly && (
            <Link href={`/app/jobs?job=${jobId}#job-estimate`}>
              Send updated estimate
            </Link>
          )}
        </div>
      )}
      {flow.changedSinceEstimate && i && (
        <p className="notice">
          This job was changed after the invoice was made. The invoice still
          shows the approved work. Start a new job for extra work.
        </p>
      )}
      {flow.processing && (
        <p className="notice">
          Card payment is still processing. Check before taking another payment.
        </p>
      )}
      {flow.refundPending && (
        <p className="notice">Refund pending. Open the invoice to check it.</p>
      )}
      {i?.disputeOpen && (
        <p className="notice">
          There is an open billing question. Check the invoice.
        </p>
      )}
      <section aria-label="Next step">
        {flow.stage === "draft" ? null : flow.stage === "awaiting" ? (
          <>
            {!readOnly && e && (
              <DocumentShare
                id={e.id}
                kind="estimate"
                primary
                label="Send estimate / reminder"
              />
            )}
            <RefreshJobStatus />
          </>
        ) : flow.stage === "declined" ? (
          <Link
            className="btn primary"
            data-page-primary
            href={`/app/jobs?edit=${jobId}`}
          >
            Change estimate
          </Link>
        ) : flow.plan ? (
          <PlanPanel plan={flow.plan} timezone={timezone} readOnly={readOnly} />
        ) : flow.stage === "ready" && flow.repeats ? (
          !readOnly && (
            <ActionForm
              action={startServicePlanAction}
              variant="primary"
              hidden={{ jobId }}
              submitLabel="Start service plan"
              pendingLabel="Adding visits…"
            />
          )
        ) : flow.stage === "ready" ? (
          progress("in_progress", "Start job")
        ) : flow.stage === "working" ? (
          progress("completed", "Mark job finished")
        ) : flow.stage === "bill" ? (
          <Link
            className="btn primary"
            data-page-primary
            href={`/app/invoices?new=1&versionId=${e?.id}`}
          >
            Create invoice
          </Link>
        ) : (
          <Link
            className="btn primary"
            data-page-primary
            href={`/app/invoices?invoiceId=${i?.id}`}
          >
            {flow.stage === "paid"
              ? "View receipt"
              : flow.stage === "attention"
                ? "Review payment"
                : "Record payment / send invoice"}
          </Link>
        )}
      </section>
      {e && (
        <details>
          <summary>Approved work &amp; customer decisions</summary>
          {a ? (
            <>
              <p>
                Signed by {a.signerName} ·{" "}
                {a.createdAt.toLocaleString("en-US", { timeZone: timezone })}
              </p>
              <h4>Approved work</h4>
              {!flow.approved.length ? (
                <p>No work approved.</p>
              ) : (
                <ul>
                  {flow.approved.map((l) => (
                    <li key={l.id}>
                      {l.description} · {formatMoney(l.totalCents)}
                    </li>
                  ))}
                </ul>
              )}
              {!!flow.declined.length && (
                <>
                  <h4>Declined work</h4>
                  <p>Leave these items out of the job.</p>
                  <ul>
                    {flow.declined.map((l) => (
                      <li key={l.id}>
                        {l.description} · {formatMoney(l.totalCents)}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p>{a.consentText}</p>
              <Link href={`/app/estimates/${e.id}/authorization.pdf`}>
                Signed approval PDF
              </Link>
            </>
          ) : (
            <p>Waiting for the customer to choose their work.</p>
          )}
          <Link href={`/app/estimates?jobId=${jobId}`}>Estimate history</Link>
          {!readOnly && (
            <ActionForm
              action={recordJobSharingAction}
              hidden={{ jobId, documentId: e.id, kind: "estimate" }}
              submitLabel="I sent the estimate"
              variant="secondary"
            />
          )}
        </details>
      )}
      {i && (
        <details>
          <summary>Invoice &amp; payment details</summary>
          <p>
            Total {formatMoney(i.totalCents)} · Received{" "}
            {formatMoney(flow.paidCents)} · Balance{" "}
            {formatMoney(flow.balanceCents)}
          </p>
          <p>
            Work:{" "}
            {flow.work === "completed"
              ? "Complete"
              : flow.work === "in_progress"
                ? "In progress"
                : "Not started"}
          </p>
          <Link href={`/app/invoices?invoiceId=${i.id}`}>
            Payments and receipt
          </Link>
          {!readOnly && <DocumentShare id={i.id} kind="invoice" />}
          {!readOnly && (
            <ActionForm
              action={recordJobSharingAction}
              hidden={{ jobId, documentId: i.id, kind: "invoice" }}
              submitLabel="I sent the invoice"
              variant="secondary"
            />
          )}
        </details>
      )}
      {flow.work === "completed" && !readOnly && e && (
        <details>
          <summary>Reopen unfinished work</summary>
          <ActionForm
            action={recordJobProgressAction}
            hidden={{
              jobId,
              versionId: e.id,
              expectedStatus: flow.work,
              status: "in_progress",
            }}
            submitLabel="Reopen work"
            variant="secondary"
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
      <details className="record-details">
        <summary>Job history</summary>
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
      </details>
    </section>
  );
}
