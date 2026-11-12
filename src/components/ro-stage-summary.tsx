import Link from "next/link";
import type { JobWorkflow } from "@/domain/job-workflow";

type Stage = JobWorkflow["stage"];

const descriptions: Partial<Record<Stage, { title: string; detail: string }>> = {
  awaiting: {
    title: "Waiting for customer authorization",
    detail: "The customer reviews each line and signs before repairs begin.",
  },
  ready: {
    title: "Authorized work ready",
    detail: "The assigned technician receives the approved repair work.",
  },
  working: {
    title: "Technician performing authorized repairs",
    detail: "Completion sends a task to the service advisor to invoice.",
  },
  bill: {
    title: "Repairs complete — advisor invoices",
    detail: "Review finished work, issue the invoice, and send the payment link.",
  },
  payment: {
    title: "Invoice sent — collect payment",
    detail: "Confirm payment before vehicle release.",
  },
  paid: {
    title: "Paid — prepare for pickup",
    detail: "Payment is recorded. Finish the vehicle pickup and RO closeout.",
  },
};

export function RoStageSummary({
  inspectionComplete,
  hasEstimate,
  technicianAssigned,
  stage,
  statusLabel,
  editHref,
}: {
  inspectionComplete: boolean;
  hasEstimate: boolean;
  technicianAssigned: boolean;
  stage?: Stage;
  statusLabel: string;
  editHref: string;
}) {
  const waiting = !inspectionComplete && !hasEstimate;
  const title = waiting
    ? technicianAssigned
      ? "Waiting on technician inspection"
      : "Assign a technician"
    : !hasEstimate
      ? "Inspection complete — build estimate"
      : descriptions[stage ?? "draft"]?.title ?? "Review the next service action";
  const detail = waiting
    ? technicianAssigned
      ? "The technician records the diagnosis and submits the inspection. The advisor is notified when it is ready."
      : "Assign a technician to inspect the vehicle. Estimate preparation follows submitted inspection findings."
    : !hasEstimate
      ? "The advisor reviews submitted findings, prices parts and labor, and sends the estimate for customer approval."
      : descriptions[stage ?? "draft"]?.detail ??
        "Review current authorization and the next action in the Work section.";

  return (
    <section className="ro-stage-panel" aria-label="Current RO stage">
      <p className="muted">
        {waiting
          ? "CURRENT STAGE · CHECK-IN & INSPECTION"
          : !hasEstimate
            ? "CURRENT STAGE · BUILD ESTIMATE"
            : `CURRENT STAGE · ${statusLabel}`}
      </p>
      <h3>{title}</h3>
      <p>{detail}</p>
      {!waiting && !hasEstimate && (
        <Link className="btn primary" href={editHref}>
          Build estimate
        </Link>
      )}
    </section>
  );
}
