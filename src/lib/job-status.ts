// One plain-language status per job, derived from its workflow. Wording
// follows the trade (auto shops send estimates; contractors send bids).
import { isAutomotive } from "./business-types";

export const JOB_STATUSES = [
  "draft",
  "sent",
  "won",
  "scheduled",
  "in_progress",
  "unbilled",
  "invoiced",
  "paid",
  "recurring",
  "paused",
  "lost",
  "expired",
  "ended",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export function jobStatusLabels(type: string): Record<JobStatus, string> {
  const auto = isAutomotive(type);
  return {
    draft: auto ? "Estimate not sent" : "Bid not sent",
    sent: auto ? "Estimate sent" : "Bid sent",
    won: auto ? "Approved" : "Won",
    scheduled: "Scheduled",
    in_progress: "In progress",
    unbilled: "Done, not billed",
    invoiced: "Invoiced",
    paid: "Paid & complete",
    recurring: "Recurring",
    paused: "Recurring (paused)",
    lost: auto ? "Declined" : "Lost",
    expired: auto ? "Estimate expired" : "Bid expired",
    ended: "Plan ended",
  };
}

// Filters shown as chips above any job list.
export const JOB_FILTERS = [
  { key: "all", label: "All", statuses: JOB_STATUSES },
  {
    key: "open",
    label: "Open",
    statuses: ["draft", "sent", "won", "scheduled", "in_progress", "unbilled"],
  },
  { key: "owed", label: "Owes money", statuses: ["invoiced"] },
  { key: "recurring", label: "Recurring", statuses: ["recurring", "paused"] },
  { key: "done", label: "Paid & done", statuses: ["paid", "ended"] },
  { key: "lost", label: "Lost", statuses: ["lost", "expired"] },
] as const satisfies readonly {
  key: string;
  label: string;
  statuses: readonly JobStatus[];
}[];
export type JobFilter = (typeof JOB_FILTERS)[number]["key"];
export const jobFilter = (key?: string) =>
  JOB_FILTERS.find((f) => f.key === key) ?? JOB_FILTERS[0];

export const statusTone = (s: JobStatus) =>
  s === "invoiced" || s === "unbilled"
    ? "pill pill-warn"
    : s === "lost" || s === "expired" || s === "ended"
      ? "pill pill-muted"
      : s === "paid"
        ? "pill pill-ok"
        : "pill";

type FlowLike = {
  stage: string;
  latest: { estimate: { expiresAt: Date } } | null;
  nextVisit?: Date | null;
};

export function jobStatus(flow: FlowLike, now = new Date()): JobStatus {
  switch (flow.stage) {
    case "draft":
      return "draft";
    case "awaiting":
      return flow.latest && new Date(flow.latest.estimate.expiresAt) <= now
        ? "expired"
        : "sent";
    case "declined":
      return "lost";
    case "ready":
      return flow.nextVisit ? "scheduled" : "won";
    case "working":
      return "in_progress";
    case "bill":
      return "unbilled";
    case "payment":
    case "attention":
      return "invoiced";
    case "paid":
      return "paid";
    case "plan":
      return "recurring";
    case "plan_paused":
      return "paused";
    default:
      return "ended";
  }
}
