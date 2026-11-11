// Durable, recipient-addressed in-app handoffs on the existing tenant activity
// ledger. No push/SMS delivery is implied; the logged-in recipient sees a task.
import { and, desc, eq, sql } from "drizzle-orm";
import { activity, jobAssignment, membership } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import { currentMemberRole } from "./membership";
import { recordActivity } from "./records";

// The relay: technician inspects -> advisor builds the estimate -> customer
// approves -> technician does the approved work -> advisor invoices.
export type JobHandoffStage =
  "inspect_vehicle" | "build_estimate" | "perform_work" | "invoice_customer";
const STAGES: readonly string[] = [
  "inspect_vehicle",
  "build_estimate",
  "perform_work",
  "invoice_customer",
];
// Which stages land in whose inbox.
export const TECHNICIAN_STAGES: JobHandoffStage[] = [
  "inspect_vehicle",
  "perform_work",
];
export const ADVISOR_STAGES: JobHandoffStage[] = [
  "build_estimate",
  "invoice_customer",
];
type HandoffData = {
  stage: JobHandoffStage;
  recipientUserId: string;
  advisorUserId: string;
  technicianUserId: string;
};
export type JobHandoff = HandoffData & {
  jobId: string;
  title: string;
  occurredAt: Date;
};

function handoffData(value: unknown): HandoffData | null {
  if (!value || typeof value !== "object") return null;
  const d = value as Partial<HandoffData>;
  if (
    typeof d.stage !== "string" ||
    !STAGES.includes(d.stage) ||
    typeof d.recipientUserId !== "string" ||
    typeof d.advisorUserId !== "string" ||
    typeof d.technicianUserId !== "string"
  )
    return null;
  return d as HandoffData;
}

// Called in the SAME tenant transaction as the assignment update.
export async function notifyTechnicianAssigned(
  tx: TenantTx,
  jobId: string,
  technicianUserId: string,
  advisorUserId: string,
) {
  await recordActivity(tx, {
    kind: "job.handoff",
    subjectType: "job",
    subjectId: jobId,
    summary:
      "Technician assigned: pick up vehicle and complete diagnosis and inspection",
    data: {
      stage: "inspect_vehicle",
      recipientUserId: technicianUserId,
      technicianUserId,
      advisorUserId,
    } satisfies HandoffData,
    recordedAtNow: true,
  });
}

// Explicitly assigned advisor takes precedence over whoever happened to
// assign the technician. Advisor identity is read from the tenant audit trail.
export async function assignedAdvisorForJob(
  tx: TenantTx,
  jobId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ data: activity.data })
    .from(activity)
    .where(
      and(
        eq(activity.businessId, tx.businessId),
        eq(activity.subjectType, "job"),
        eq(activity.subjectId, jobId),
        eq(activity.kind, "job.advisor_assigned"),
      ),
    )
    .orderBy(desc(activity.occurredAt), desc(activity.id))
    .limit(1);
  const data = row?.data as { advisorUserId?: unknown } | undefined;
  return typeof data?.advisorUserId === "string" ? data.advisorUserId : null;
}

// Reassignment updates the open estimate task atomically with the advisor
// assignment. The previous recipient stops seeing the now-obsolete handoff.
export async function reassignAdvisorHandoff(
  tx: TenantTx,
  jobId: string,
  newAdvisorId: string,
) {
  const [latest] = await tx
    .select({ data: activity.data })
    .from(activity)
    .where(
      and(
        eq(activity.businessId, tx.businessId),
        eq(activity.subjectType, "job"),
        eq(activity.subjectId, jobId),
        eq(activity.kind, "job.handoff"),
      ),
    )
    .orderBy(desc(activity.occurredAt), desc(activity.id))
    .limit(1);
  const current = handoffData(latest?.data);
  if (!current || !ADVISOR_STAGES.includes(current.stage)) return false;
  await recordActivity(tx, {
    kind: "job.handoff",
    subjectType: "job",
    subjectId: jobId,
    summary:
      current.stage === "build_estimate"
        ? "Inspection complete: newly assigned advisor to build estimate"
        : "Work completed: newly assigned advisor to invoice the customer",
    data: {
      ...current,
      advisorUserId: newAdvisorId,
      recipientUserId: newAdvisorId,
    },
    recordedAtNow: true,
  });
  // A waiting estimate moved to a new advisor: they get the ping.
  return true;
}

// Called once when a previously incomplete checklist becomes complete.
// Resolves the assigned advisor from the current assignment handoff, never
// from arbitrary client-supplied IDs or a technician's text field.
export async function notifyAdvisorInspectionComplete(
  tx: TenantTx,
  jobId: string,
): Promise<boolean> {
  const [assignment] = await tx
    .select({ userId: jobAssignment.userId })
    .from(jobAssignment)
    .where(
      and(
        eq(jobAssignment.businessId, tx.businessId),
        eq(jobAssignment.jobId, jobId),
      ),
    )
    .limit(1);
  if (!assignment?.userId) return false;
  const history = await tx
    .select({ data: activity.data })
    .from(activity)
    .where(
      and(
        eq(activity.businessId, tx.businessId),
        eq(activity.subjectType, "job"),
        eq(activity.subjectId, jobId),
        eq(activity.kind, "job.handoff"),
      ),
    )
    .orderBy(desc(activity.occurredAt), desc(activity.id))
    .limit(30);
  const assignmentEvent = history
    .map((e) => handoffData(e.data))
    .find(
      (e) =>
        e?.stage === "inspect_vehicle" &&
        e.technicianUserId === assignment.userId,
    );
  if (!assignmentEvent) return false;
  const advisorId =
    (await assignedAdvisorForJob(tx, jobId)) ?? assignmentEvent.advisorUserId;
  await recordActivity(tx, {
    kind: "job.handoff",
    subjectType: "job",
    subjectId: jobId,
    summary: "Inspection completed: advisor to build and send estimate",
    data: {
      ...assignmentEvent,
      stage: "build_estimate",
      recipientUserId: advisorId,
      advisorUserId: advisorId,
    } satisfies HandoffData,
    recordedAtNow: true,
  });
  return true;
}

export async function listMyJobHandoffs(tx: TenantTx): Promise<JobHandoff[]> {
  const id = tx.actor.type === "user" ? tx.actor.id : null;
  if (!id) return [];
  const role = await currentMemberRole(tx);
  if (!role) return [];
  const latest = tx
    .selectDistinctOn([activity.subjectId], {
      jobId: activity.subjectId,
      title: activity.summary,
      data: activity.data,
      occurredAt: activity.occurredAt,
    })
    .from(activity)
    .where(
      and(
        eq(activity.businessId, tx.businessId),
        eq(activity.kind, "job.handoff"),
        eq(activity.subjectType, "job"),
      ),
    )
    .orderBy(activity.subjectId, desc(activity.occurredAt), desc(activity.id))
    .as("latest_handoffs");
  // Choose the latest event per RO before filtering the recipient. A reassigned
  // or completed task must not revive for an earlier recipient. Bound the result,
  // not the shared event history, and check current assignment in the same query.
  const rows = await tx
    .select({
      jobId: latest.jobId,
      title: latest.title,
      data: latest.data,
      occurredAt: latest.occurredAt,
    })
    .from(latest)
    .leftJoin(
      jobAssignment,
      and(
        eq(jobAssignment.businessId, tx.businessId),
        eq(jobAssignment.jobId, latest.jobId),
      ),
    )
    .where(
      and(
        sql`${latest.data}->>'recipientUserId' = ${id}`,
        role === "technician"
          ? sql`${latest.data}->>'stage' IN ('inspect_vehicle','perform_work')`
          : sql`${latest.data}->>'stage' IN ('build_estimate','invoice_customer')`,
        role === "technician" ? eq(jobAssignment.userId, id) : undefined,
      ),
    )
    .orderBy(desc(latest.occurredAt))
    .limit(500);
  const output: JobHandoff[] = [];
  for (const row of rows) {
    const data = handoffData(row.data);
    if (!data || data.recipientUserId !== id) continue;
    if (role === "technician" && !TECHNICIAN_STAGES.includes(data.stage))
      continue;
    if (role !== "technician" && !ADVISOR_STAGES.includes(data.stage)) continue;
    output.push({
      ...data,
      jobId: row.jobId,
      title: row.title,
      occurredAt: row.occurredAt,
    });
  }
  return output;
}

export async function assertAssignedTechnician(tx: TenantTx, jobId: string) {
  if (tx.actor.type !== "user" || !tx.actor.id)
    throw new AppError("FORBIDDEN", "Sign in to work on this job.");
  const [assigned] = await tx
    .select({ userId: jobAssignment.userId })
    .from(jobAssignment)
    .where(
      and(
        eq(jobAssignment.businessId, tx.businessId),
        eq(jobAssignment.jobId, jobId),
      ),
    )
    .limit(1);
  if (assigned?.userId !== tx.actor.id)
    throw new AppError(
      "FORBIDDEN",
      "This repair order is not assigned to you.",
    );
}

/** Publishing the estimate clears the assigned advisor's current handoff. */
export async function completeAdvisorHandoff(tx: TenantTx, jobId: string) {
  const [latest] = await tx
    .select({ data: activity.data })
    .from(activity)
    .where(
      and(
        eq(activity.businessId, tx.businessId),
        eq(activity.subjectType, "job"),
        eq(activity.subjectId, jobId),
        eq(activity.kind, "job.handoff"),
      ),
    )
    .orderBy(desc(activity.occurredAt), desc(activity.id))
    .limit(1);
  const data = handoffData(latest?.data);
  if (data?.stage !== "build_estimate") return;
  await recordActivity(tx, {
    kind: "job.handoff",
    subjectType: "job",
    subjectId: jobId,
    summary: "Advisor published the estimate; preparation task completed",
    data: { ...data, stage: "completed" },
    recordedAtNow: true,
  });
}

async function latestHandoff(tx: TenantTx, jobId: string) {
  const [latest] = await tx
    .select({ data: activity.data })
    .from(activity)
    .where(
      and(
        eq(activity.businessId, tx.businessId),
        eq(activity.subjectType, "job"),
        eq(activity.subjectId, jobId),
        eq(activity.kind, "job.handoff"),
      ),
    )
    .orderBy(desc(activity.occurredAt), desc(activity.id))
    .limit(1);
  return handoffData(latest?.data);
}

// The advisor responsible for an RO: explicitly assigned, else whoever the
// relay last named, else the shop owner so the handoff is never dropped.
async function advisorFor(tx: TenantTx, jobId: string) {
  const assigned = await assignedAdvisorForJob(tx, jobId);
  if (assigned) return assigned;
  // Finished handoffs still name the advisor, so read the raw event.
  const [previous] = await tx
    .select({ data: activity.data })
    .from(activity)
    .where(
      and(
        eq(activity.businessId, tx.businessId),
        eq(activity.subjectType, "job"),
        eq(activity.subjectId, jobId),
        eq(activity.kind, "job.handoff"),
      ),
    )
    .orderBy(desc(activity.occurredAt), desc(activity.id))
    .limit(1);
  const named = (previous?.data as { advisorUserId?: unknown } | null)
    ?.advisorUserId;
  if (typeof named === "string") return named;
  const [owner] = await tx
    .select({ userId: membership.userId })
    .from(membership)
    .where(
      and(
        eq(membership.businessId, tx.businessId),
        eq(membership.role, "owner"),
        eq(membership.status, "active"),
      ),
    )
    .orderBy(membership.createdAt)
    .limit(1);
  return owner?.userId ?? null;
}

async function assignedTechnician(tx: TenantTx, jobId: string) {
  const [assignment] = await tx
    .select({ userId: jobAssignment.userId })
    .from(jobAssignment)
    .where(
      and(
        eq(jobAssignment.businessId, tx.businessId),
        eq(jobAssignment.jobId, jobId),
      ),
    )
    .limit(1);
  return assignment?.userId ?? null;
}

// The customer authorized work (or finished work was reopened): the assigned
// technician gets the approved work list. No technician yet: nothing to hand
// off until one is assigned.
export async function notifyTechnicianWorkApproved(
  tx: TenantTx,
  jobId: string,
): Promise<boolean> {
  const technicianUserId = await assignedTechnician(tx, jobId);
  const advisorUserId = await advisorFor(tx, jobId);
  if (!technicianUserId || !advisorUserId) return false;
  await recordActivity(tx, {
    kind: "job.handoff",
    subjectType: "job",
    subjectId: jobId,
    summary: "Customer approved: technician to complete the authorized work",
    data: {
      stage: "perform_work",
      recipientUserId: technicianUserId,
      technicianUserId,
      advisorUserId,
    } satisfies HandoffData,
    recordedAtNow: true,
  });
  return true;
}

// The technician marked the authorized work complete: the advisor invoices
// the customer and collects payment.
export async function notifyAdvisorWorkCompleted(
  tx: TenantTx,
  jobId: string,
): Promise<boolean> {
  const advisorUserId = await advisorFor(tx, jobId);
  if (!advisorUserId) return false;
  const technicianUserId =
    (await assignedTechnician(tx, jobId)) ??
    (tx.actor.type === "user" && tx.actor.id ? tx.actor.id : advisorUserId);
  await recordActivity(tx, {
    kind: "job.handoff",
    subjectType: "job",
    subjectId: jobId,
    summary: "Work completed: advisor to invoice the customer and collect",
    data: {
      stage: "invoice_customer",
      recipientUserId: advisorUserId,
      technicianUserId,
      advisorUserId,
    } satisfies HandoffData,
    recordedAtNow: true,
  });
  return true;
}

/** Issuing the invoice clears the advisor's "invoice the customer" task. */
export async function completeInvoiceHandoff(tx: TenantTx, jobId: string) {
  const data = await latestHandoff(tx, jobId);
  if (data?.stage !== "invoice_customer") return;
  await recordActivity(tx, {
    kind: "job.handoff",
    subjectType: "job",
    subjectId: jobId,
    summary: "Advisor issued the invoice; handoff completed",
    data: { ...data, stage: "completed" },
    recordedAtNow: true,
  });
}
