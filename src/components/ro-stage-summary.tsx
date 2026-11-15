import Link from "next/link";
import type { JobWorkflow } from "@/domain/job-workflow";

type Stage = JobWorkflow["stage"];

type Step =
  | "intake"
  | "inspection"
  | "proposal"
  | "approval"
  | "repair"
  | "invoice"
  | "payment";

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
    detail:
      "The proposal is saved. Use Documents to preview it, send it, and see the customer's approval or decline.",
    step: "approval",
  },
  declined: {
    title: "Review declined recommendations",
    detail:
      "Keep the declined work in the RO history. Review any approved work before proceeding.",
    step: "approval",
  },
  ready: {
    title: "Approved work is ready",
    detail:
      "Only customer-authorized work can be released to the assigned technician.",
    step: "repair",
  },
  working: {
    title: "Repairs in progress",
    detail:
      "The technician completes approved work and hands the RO back to the service advisor.",
    step: "repair",
  },
  bill: {
    title: "Prepare the final invoice",
    detail:
      "Review completed wor¶»§q«^