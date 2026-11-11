import type { JobStatus } from "./job-status";

export const WORK_SECTIONS = [
  {
    key: "attention",
    title: "Needs attention",
    description: "Estimates, approvals and balances that need a next step.",
    statuses: [
      "draft",
      "sent",
      "won",
      "unbilled",
      "invoiced",
      "paused",
      "expired",
    ],
  },
  {
    key: "active",
    title: "In progress",
    description: "Scheduled work, work underway and recurring service.",
    statuses: ["scheduled", "in_progress", "recurring"],
  },
  {
    key: "closed",
    title: "Closed work",
    description: "Finished, declined and ended work, kept for reference.",
    statuses: ["paid", "lost", "ended"],
  },
] as const satisfies readonly {
  key: string;
  title: string;
  description: string;
  statuses: readonly JobStatus[];
}[];

export function groupWork<T>(
  rows: readonly T[],
  status: (row: T) => JobStatus,
) {
  return WORK_SECTIONS.map((section) => ({
    ...section,
    items: rows.filter((row) =>
      (section.statuses as readonly JobStatus[]).includes(status(row)),
    ),
  }));
}
