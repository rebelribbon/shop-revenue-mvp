// Who's on each job and visit. Kept apart from the board and "My day" so
// both can read it without importing each other.
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  appointment,
  customer,
  task,
  inspection,
  jobAssignment,
  membership,
  user,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError, notFound } from "@/lib/errors";
import { assertManager } from "./membership";
import { loadJobWorkflows } from "./job-workflow";
import { getJob, jobInput } from "./jobs";
import { audit, recordActivity, type RequestMeta } from "./records";
import {
  notifyTechnicianAssigned,
  notifyTechnicianWorkApproved,
  assignedAdvisorForJob,
  reassignAdvisorHandoff,
} from "./job-handoffs";

export type Tech = { userId: string; name: string };

// Only active technician accounts may be assigned technician work.
export async function listTechs(tx: TenantTx): Promise<Tech[]> {
  const rows = await tx
    .select({
      userId: membership.userId,
      name: user.displayName,
      email: user.email,
      role: membership.role,
    })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(
      and(
        eq(membership.businessId, tx.businessId),
        eq(membership.status, "active"),
        eq(membership.role, "technician"),
        isNotNull(membership.userId),
      ),
    )
    .orderBy(membership.createdAt);
  return rows.map((r) => ({
    userId: r.userId!,
    name: r.name?.trim() || r.email?.split("@")[0] || "Team member",
  }));
}

export async function listAdvisors(tx: TenantTx): Promise<Tech[]> {
  const rows = await tx
    .select({
      userId: membership.userId,
      name: user.displayName,
      email: user.email,
    })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(
      and(
        eq(membership.businessId, tx.businessId),
        eq(membership.status, "active"),
        inArray(membership.role, ["staff", "owner"]),
        isNotNull(membership.userId),
      ),
    )
    .orderBy(membership.createdAt);
  return rows.map((r) => ({
    userId: r.userId!,
    name: r.name?.trim() || r.email?.split("@")[0] || "Advisor",
  }));
}
export async function assignAdvisor(
  tx: TenantTx,
  meta: RequestMeta,
  input: { jobId: string; userId: string },
) {
  await assertCanAssign(tx);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${input.jobId},0))`,
  );
  const job = await getJob(tx, input.jobId);
  if (!job) throw notFound("That job");
  const advisor = (await listAdvisors(tx)).find(
    (x) => x.userId === input.userId,
  );
  if (!advisor)
    throw new AppError(
      "VALIDATION",
      "Choose an active advisor or owner from this shop.",
    );
  const before = await assignedAdvisorForJob(tx, input.jobId);
  if (before === input.userId)
    return { jobId: input.jobId, advisor: advisor.name, handoff: false };
  await recordActivity(tx, {
    kind: "job.advisor_assigned",
    subjectType: "job",
    subjectId: input.jobId,
    summary: `Service advisor assigned: ${advisor.name}`,
    data: { advisorUserId: input.userId },
    recordedAtNow: true,
  });
  const handoff = await reassignAdvisorHandoff(tx, input.jobId, input.userId);
  const parsed = jobInput.pick({ customerId: true }).safeParse(job.data);
  if (parsed.success) {
    // Reassignment transfers contact ownership and its open advisor tasks.
    await tx.update(customer).set({ assignedUserId: input.userId })
      .where(and(eq(customer.businessId, tx.businessId), eq(customer.id, parsed.data.customerId)));
    await tx.update(task).set({ assignedUserId: input.userId })
      .where(and(eq(task.businessId, tx.businessId), sql`${task.doneAt} IS NULL`,
        sql`(${task.jobId} = ${input.jobId} OR (${task.customerId} = ${parsed.data.customerId} AND ${task.assignedUserId} IS NOT DISTINCT FROM ${before}))`));
  }
  await audit(tx, meta, {
    action: "job.advisor_assigned",
    targetType: "job",
    targetId: input.jobId,
    before: { userId: before },
    after: { userId: input.userId },
  });
  return { jobId: input.jobId, advisor: advisor.name, handoff };
}

// jobId → userId for the jobs given (or every job).
export async function jobAssignees(tx: TenantTx, jobIds?: string[]) {
  if (jobIds && !jobIds.length) return new Map<string, string>();
  const rows = await tx
    .select({ jobId: jobAssignment.jobId, userId: jobAssignment.userId })
    .from(jobAssignment)
    .where(
      and(
        eq(jobAssignment.businessId, tx.businessId),
        isNotNull(jobAssignment.userId),
        jobIds ? inArray(jobAssignment.jobId, jobIds) : undefined,
      ),
    );
  return new Map(rows.map((r) => [r.jobId, r.userId!]));
}

async function requireTech(tx: TenantTx, userId: string | null) {
  if (userId === null) return null;
  const tech = (await listTechs(tx)).find((t) => t.userId === userId);
  if (!tech)
    throw new AppError("VALIDATION", "Pick someone who’s on your team.");
  return tech;
}

export async function assignJob(
  tx: TenantTx,
  meta: RequestMeta,
  input: { jobId: string; userId: string | null },
) {
  await assertCanAssign(tx);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${input.jobId},0))`,
  );
  if (!(await getJob(tx, input.jobId))) throw notFound("That job");
  const tech = await requireTech(tx, input.userId);
  const before = (await jobAssignees(tx, [input.jobId])).get(input.jobId);
  if ((before ?? null) === input.userId)
    return { jobId: input.jobId, tech: tech?.name ?? null, handoff: false };
  await tx
    .insert(jobAssignment)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.type === "user" ? tx.actor.id : null,
      jobId: input.jobId,
      userId: input.userId,
    })
    .onConflictDoUpdate({
      target: [jobAssignment.businessId, jobAssignment.jobId],
      set: { userId: input.userId },
    });
  // The assignment and targeted handoff are committed atomically. Reassignment
  // creates a newer handoff, invalidating the former technician's inbox item.
  const [submittedInspection] = await tx
    .select({ completedAt: inspection.completedAt })
    .from(inspection)
    .where(
      and(
        eq(inspection.businessId, tx.businessId),
        eq(inspection.jobId, input.jobId),
      ),
    )
    .limit(1);
  // True when this assignment handed the RO to a technician (they get pinged).
  let handoff = false;
  // Customer-approved work that isn't finished outranks the inspection: the
  // newly assigned technician gets the approved work list.
  const flow = input.userId
    ? (await loadJobWorkflows(tx, [input.jobId])).get(input.jobId)
    : undefined;
  if (
    flow?.latest?.authorization &&
    flow.approved.length > 0 &&
    flow.work !== "completed"
  )
    handoff = await notifyTechnicianWorkApproved(tx, input.jobId);
  else if (
    input.userId &&
    tx.actor.type === "user" &&
    tx.actor.id &&
    !submittedInspection?.completedAt
  ) {
    handoff = true;
    await notifyTechnicianAssigned(
      tx,
      input.jobId,
      input.userId,
      (await assignedAdvisorForJob(tx, input.jobId)) ?? tx.actor.id,
    );
  }
  await audit(tx, meta, {
    action: "job.assigned",
    targetType: "job",
    targetId: input.jobId,
    before: { userId: before ?? null },
    after: { userId: input.userId },
  });
  return { jobId: input.jobId, tech: tech?.name ?? null, handoff };
}

export async function assignVisit(
  tx: TenantTx,
  meta: RequestMeta,
  input: { appointmentId: string; userId: string | null },
) {
  await assertCanAssign(tx);
  const tech = await requireTech(tx, input.userId);
  const [row] = await tx
    .update(appointment)
    .set({ assignedUserId: input.userId })
    .where(
      and(
        eq(appointment.businessId, tx.businessId),
        eq(appointment.id, input.appointmentId),
      ),
    )
    .returning({ id: appointment.id });
  if (!row) throw notFound("That visit");
  await audit(tx, meta, {
    action: "appointment.assigned",
    targetType: "appointment",
    targetId: row.id,
    after: { userId: input.userId },
  });
  return { appointmentId: row.id, tech: tech?.name ?? null };
}

async function assertCanAssign(tx: TenantTx) {
  await assertManager(tx);
}

export async function assignCustomer(
  tx: TenantTx,
  meta: RequestMeta,
  input: { customerId: string; userId: string },
) {
  await assertManager(tx);
  const advisor = (await listAdvisors(tx)).find(a => a.userId === input.userId);
  if (!advisor) throw new AppError("VALIDATION", "Choose an active advisor.");
  const [before] = await tx.select({assignedUserId:customer.assignedUserId})
    .from(customer)
    .where(and(eq(customer.businessId,tx.businessId),eq(customer.id,input.customerId)));
  if (!before) throw notFound("That customer");
  await tx.update(customer).set({assignedUserId:input.userId})
    .where(and(eq(customer.businessId,tx.businessId),eq(customer.id,input.customerId)));
  await tx.update(task).set({assignedUserId:input.userId})
    .where(and(eq(task.businessId,tx.businessId),eq(task.customerId,input.customerId),
      eq(task.assignedUserId,before.assignedUserId ?? ""),sql`${task.doneAt} IS NULL`));
  await audit(tx,meta,{action:"customer.assigned",targetType:"customer",targetId:input.customerId,
    before:{userId:before.assignedUserId},after:{userId:input.userId}});
  return {customerId:input.customerId,message:`Assigned to ${advisor.name}.`};
}
