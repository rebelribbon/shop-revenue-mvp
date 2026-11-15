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
    detail: "The proposal is saved. Use Documents to preview it, send it, and see the customer's approval or decline.",
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
  technicianAssigned,
  stage,
  statusLabel,
  editHref,
  documentsHref,
  technicianHref,
}: {
  inspectionComplete: boolean;
  hasEstimate: boolean;
  technicianAssigned: boolean;
  stage?: Stage;
  statusLabel: string;
  editHref: string;
  documentsHref: string;
  technicianHref?: string;
}) {
  const waiting = !inspectionComplete && !hasEstimate;
  const current: Step = !technicianAssigned
    ? "intake"
    : waiting
      ? "inspection"
      : !hasEstimate
        ? "proposal"
        : descriptions[stage ?? "draft"]?.step ?? "approval";
  const active = stages.findIndex((s) => s.id === current);
  const title = !technicianAssigned
    ? "Assign a technician"
    : waiting
      ? "Waiting for technician inspection"
      : !hasEstimate
        ? "Price the inspection recommendations"
        : descriptions[stage ?? "draft"]?.title ?? "Review the next service step";
  const detail = !technicianAssigned
    ? "Select one technician for the entire RO. The technician receives the inspection task."
    : waiting
      ? "The technician records findings and evidence. The advisor will be notified once the inspection is submitted."
      : !hasEstimate
        ? "Build parts and labor for each repair, then review the customer-facing proposal in Documents."
        : descriptions[stage ?? "draft"]?.detail ??
          "Open Documents to review the estimate and the customer response.";
  const nextHref = !technicianAssigned
    ? null
    : waiting
      ? technicianHref
      : !hasEstimate
        ? editHref
        : ["awaiting", "declined", "draft"].includes(stage ?? "draft")
          ? documentsHref
          : null;
  const nextLabel = waiting
    ? "Open technician inspection"
    : !hasEstimate
      ? "Price parts & labor"
      : "Open proposal & documents";

  return (
    <section className="ro-stage-panel ro-guided-stage" aria-label="Repair order progress">
      <p className="muted ro-stage-eyebrow">REPAIR ORDER · {statusLabel}</p>
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
        <p className="muted">WHAT HAPPENS NEXT</p>
        <h3>{title}</h3>
        <p>{detail}</p>
        {nextHref && (
          <Link className="btn primary" href={nextHref}>
            {nextLabel}
          </Link>
        )}
        {hasEstimate && nextHref !== documentsHref && (
          <Link className="ro-secondary-link" href={documentsHref}>
            View customer documents
          </Link>
        )}
      </div>
    </section>
  );
}
