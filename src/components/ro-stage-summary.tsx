import Link from "next/link";
import type { JobWorkflow } from "@/domain/job-workflow";

type Stage = JobWorkflow["stage"];

type Step = "intake" | "inspection" | "proposal" | "approval" | "repair" | "invoice" | "payment";

const stages: { id: Step; label: string }[] = [
  { id: "intake", label: "Intake" },
  { id: "inspection", label: "Inspect" },
  { id: "proposal", label: "Proposal" },
  { id: "approval", label: "Approve" },
  { id: "repair", label: "Repair" },
  { id: "invoice", label: "Invoice" },
  { id: "payment", label: "Payment" },
];

const descriptions: Partial<
  Record<Stage, { title: string; detail: string; step: Step }>
> = {
  awaiting: {
    title: "Review customer approval",
    detail: "The customer packet is ready on this RO. Review the documents, send the proposal, and track the response below.",
    step: "approval",
  },
  declined: {
    title: "Review declined recommendations",
    detail: "Keep the declined work in the RO history. Review any approved work before proceeding.",
    step: "approval",
  },
  ready: {
    title: "Approved work is ready",
    detail: "Only customer-authorized work can be released to the assigned technician.",
    step: "repair",
  },
  working: {
    title: "Repairs in progress",
    detail: "The technician completes approved work and hands the RO back to the service advisor.",
    step: "repair",
  },
  bill: {
    title: "Prepare the final invoice",
    detail: "Review completed work, create the invoice, and send it to the customer for payment.",
    step: "invoice",
  },
  payment: {
    title: "Collect payment",
    detail: "Open the payment record, confirm payment, and prepare the vehicle for release.",
    step: "payment",
  },
  paid: {
    title: "Paid — ready for pickup",
    detail: "Payment has been recorded. Finish the vehicle pickup and close out the RO.",
    step: "payment",
  },
  attention: {
    title: "Payment needs review",
    detail: "Resolve the payment status before closing this repair order.",
    step: "payment",
  },
};

export function RoStageSummary({
  inspectionComplete,
  hasEstimate,
  hasPricedDraft = false,
  reviewHref,
  technicianAssigned,
  stage,
  editHref,
  documentsHref,
  proposalHref,
  workflowHref,
  technicianHref,
}: {
  inspectionComplete: boolean;
  hasEstimate: boolean;
  hasPricedDraft?: boolean;
  reviewHref?: string;
  technicianAssigned: boolean;
  stage?: Stage;
  editHref: string;
  documentsHref: string;
  proposalHref?: string;
  workflowHref?: string;
  technicianHref?: string;
}) {
  const waiting = !inspectionComplete && !hasEstimate;
  const current: Step = waiting
    ? technicianAssigned ? "inspection" : "intake"
    : !hasEstimate
      ? "proposal"
      : descriptions[stage ?? "draft"]?.step ?? "approval";
  const active = stages.findIndex((s) => s.id === current);
  const title = waiting && !technicianAssigned
    ? "Assign a technician"
    : waiting
      ? "Waiting for technician inspection"
      : !hasEstimate
        ? hasPricedDraft ? "Review customer packet" : "Price the inspection recommendations"
        : descriptions[stage ?? "draft"]?.title ?? "Review the next service step";
  const detail = waiting && !technicianAssigned
    ? "Select one technician for the entire RO. The technician receives the inspection task."
    : waiting
      ? "The technician records findings and evidence. The advisor will be notified once the inspection is submitted."
      : !hasEstimate
        ? hasPricedDraft
          ? "Pricing is saved. Review the documents and finalize the packet below."
          : "Build parts and labor, then review and send the proposal directly on the RO Overview."
        : descriptions[stage ?? "draft"]?.detail ??
          "Review the customer proposal and response below on this RO.";
  const nextHref = waiting && !technicianAssigned
    ? null
    : waiting
      ? technicianHref
      : !hasEstimate
        ? (hasPricedDraft ? reviewHref ?? editHref : editHref)
        : ["awaiting", "declined", "draft"].includes(stage ?? "draft")
          ? (proposalHref ?? documentsHref)
          : ["ready", "working", "bill", "payment", "attention"].includes(stage ?? "")
            ? workflowHref
            : null;
  const nextLabel = waiting
    ? "Open technician inspection"
    : !hasEstimate
      ? (hasPricedDraft ? "Review & finalize packet" : "Price parts & labor")
      : ["ready", "working"].includes(stage ?? "")
        ? "Review approved work"
        : stage === "bill"
          ? "Prepare invoice"
          : ["payment", "attention"].includes(stage ?? "")
            ? "Review payment"
            : "Review customer proposal";

  return (
    <section className="ro-stage-panel ro-guided-stage" aria-label="Repair order progress">
      <p className="muted ro-stage-eyebrow">CURRENT STEP · {active + 1} OF {stages.length}</p>
      <ol className="ro-progress" aria-label="Service progress">
        {stages.map((step, index) => (
          <li
            key={step.id}
            className={index === active ? "is-current" : index < active ? "is-complete" : ""}
            aria-current={index === active ? "step" : undefined}
          >
            <span className="ro-progress-dot" aria-hidden="true">
              {index < active ? "✓" : index + 1}
            </span>
            <span>{step.label}</span>
          </li>
        ))}
      </ol>
      <div className="ro-stage-next">
        <h3>{title}</h3>
        <p className="ro-stage-description">{detail}</p>
        {nextHref && (
          <Link className="btn primary" href={nextHref}>
            {nextLabel}
          </Link>
        )}
        {hasEstimate && !nextHref && stage === "paid" && (
          <span className="muted ro-stage-complete">Service workflow complete</span>
        )}
      </div>
    </section>
  );
}
