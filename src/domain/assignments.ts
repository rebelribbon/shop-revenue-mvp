// Who's on each job and visit. Kept apart from the board and "My day" so
// both can read it without importing each other.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { appointment, jobAssignment, membership, user } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError, notFound } from "@/lib/errors";
import { currentMemberRole } from "./membership";
import { getJob } from "./jobs";
import { audit, type RequestMeta } from "./records";
import { notifyTechnicianAssigned } from "./job-handoffs";

export type Tech = { userId: string; name: string };

// Everyone active on the team, owner included: anyone can be on a job.
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
  if (!(await getJob(tx, input.jobId))) throw notFound("That job");
  const tech = await requireTech(tx, input.userId);
  const before = (await jobAssignees(tx, [input.jobId])).get(input.jobId);
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
  if (input.userId && tx.actor.type === "user" && tx.actor.id) {
    await notifyTechnicianAssigned(tx, input.jobId, input.userId, tx.actor.id);
  }
  await audit(tx, meta, {
    action: "job.assigned",
    targetType: "job",
    targetId: input.jobId,
    before: { userId: before ?? null },
    after: { userId: input.userId },
  });
  return { jobId: input.jobId, tech: tech?.name ?? null };
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
  if ((await currentMemberRole(tx)) === "technician")
    throw new AppError(
      "FORBIDDEN",
      "Ask the front office to change assignments.",
    );
}
