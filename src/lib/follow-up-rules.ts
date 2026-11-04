// The shop's follow-up rules: which reminders show up in Tasks, and when.
// Stored on business.follow_up_rules; anything missing uses these defaults.
import { z } from "zod";

const days = (fallback: number, max = 365) =>
  z.number().int().min(0).max(max).catch(fallback).default(fallback);
const on = z.boolean().catch(true).default(true);

const shape = z.object({
  // New customer, no job, estimate or visit yet.
  // Every day until they book: a lead goes cold fast.
  newLead: z
    .object({ on, days: days(1, 60) })
    .catch({ on: true, days: 1 })
    .default({ on: true, days: 1 }),
  // Estimate sent, not approved.
  estimate: z
    .object({ on, days: days(2, 60) })
    .catch({ on: true, days: 2 })
    .default({ on: true, days: 2 }),
  // Invoice not paid; repeats every `days` until paid.
  unpaid: z
    .object({ on, days: days(1, 60) })
    .catch({ on: true, days: 1 })
    .default({ on: true, days: 1 }),
  // Work in progress: keep the customer posted.
  jobUpdate: z
    .object({ on, days: days(2, 30) })
    .catch({ on: true, days: 2 })
    .default({ on: true, days: 2 }),
  // Paid customer who hasn't been back.
  pastCustomer: z
    .object({ on, months: days(6, 24) })
    .catch({ on: true, months: 6 })
    .default({ on: true, months: 6 }),
  // Customer said no to recommended work.
  declined: z
    .object({ on, days: days(0, 365) })
    .catch({ on: true, days: 0 })
    .default({ on: true, days: 0 }),
  // A next-service date is coming up.
  serviceDue: z
    .object({ on, daysBefore: days(14, 90) })
    .catch({ on: true, daysBefore: 14 })
    .default({ on: true, daysBefore: 14 }),
  // Confirm a booked visit ahead of time.
  confirmVisit: z
    .object({ on, daysBefore: days(1, 7) })
    .catch({ on: true, daysBefore: 1 })
    .default({ on: true, daysBefore: 1 }),
  // A job's warranty is about to run out: invite them in for a check.
  warranty: z
    .object({ on, daysBefore: days(30, 90) })
    .catch({ on: true, daysBefore: 30 })
    .default({ on: true, daysBefore: 30 }),
});
export type FollowUpRules = z.infer<typeof shape>;
export const DEFAULT_FOLLOW_UP_RULES: FollowUpRules = shape.parse({});
export const followUpRules = shape.catch(DEFAULT_FOLLOW_UP_RULES);

export const readFollowUpRules = (raw: unknown): FollowUpRules =>
  followUpRules.parse(raw ?? {});

// After you mark a reminder done, how long until it comes back if the reason
// is still there (invoice still unpaid, work still going, …).
export function repeatAfterDays(
  category: string,
  rules: FollowUpRules,
): number {
  switch (category) {
    case "new_lead":
      return Math.max(rules.newLead.days, 1);
    case "open_estimate":
      return Math.max(rules.estimate.days, 1);
    case "unpaid_invoice":
      return Math.max(rules.unpaid.days, 1);
    case "job_update":
      return Math.max(rules.jobUpdate.days, 1);
    case "lapsed":
      return 90;
    default:
      return 30;
  }
}

// Plain-English rule list for Settings (order is the order shown).
export const RULE_TEXT = [
  {
    key: "newLead",
    title: "New leads",
    before: "Call a new lead with no job yet every",
    unit: "days",
    field: "days",
  },
  {
    key: "estimate",
    title: "Estimates",
    before: "Remind me when an estimate isn't approved after",
    unit: "days",
    field: "days",
  },
  {
    key: "unpaid",
    title: "Unpaid invoices",
    before: "Follow up on an unpaid invoice every",
    unit: "days",
    field: "days",
  },
  {
    key: "jobUpdate",
    title: "Work updates",
    before: "While work is in progress, update the customer every",
    unit: "days",
    field: "days",
  },
  {
    key: "pastCustomer",
    title: "Past customers",
    before: "Check in with a customer who hasn't been back in",
    unit: "months",
    field: "months",
  },
  {
    key: "declined",
    title: "Declined work",
    before: "Follow up on work the customer said no to after",
    unit: "days",
    field: "days",
  },
  {
    key: "serviceDue",
    title: "Service due",
    before: "Remind me before a next-service date by",
    unit: "days",
    field: "daysBefore",
  },
  {
    key: "confirmVisit",
    title: "Confirm visits",
    before: "Remind me to confirm a booked visit this many days before",
    unit: "days",
    field: "daysBefore",
  },
  {
    key: "warranty",
    title: "Warranty ending",
    before: "Remind me before a job’s warranty runs out by",
    unit: "days",
    field: "daysBefore",
  },
] as const;
