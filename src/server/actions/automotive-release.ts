"use server";
import { z } from "zod";
import { AppError, notFound } from "@/lib/errors";
import { canManageTeam, currentMemberRole } from "@/domain/membership";
import { assignedAdvisorForJob } from "@/domain/job-handoffs";
import { loadJobWorkflows } from "@/domain/job-workflow";
import { recordActivity, audit } from "@/domain/records";
import { defineShopAction } from "./define";

export const releaseAutomotiveRoAction = defineShopAction({
  name: "releaseAutomotiveRo",
  input: z.object({ jobId: z.uuid() }),
  run: async ({ tx, meta }, { jobId }) => {
    if (tx.actor.type !== "user")
      throw new AppError("FORBIDDEN", "Only the signed-in shop staff can release a vehicle.");
    const member = await currentMemberRole(tx);
    const manager = await canManageTeam(tx);
    if (member === "technician" || (member === "staff" && !manager &&
      (await assignedAdvisorForJob(tx, jobId)) !== tx.actor.id))
      throw new AppError("FORBIDDEN", "Only the assigned advisor or manager can release this vehicle.");
    const flow = (await loadJobWorkflows(tx, [jobId])).get(jobId);
    if (!flow) throw notFound("That repair order");
    if (flow.stage !== "paid" || flow.balanceCents > 0 || flow.refundPending || flow.processing)
      throw new AppError("INVALID_TRANSITION", "A vehicle cannot be released until the entire invoice is paid and no payment is pending.");
    const { activity } = await import("@/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const [prior] = await tx.select({id: activity.id}).from(activity).where(and(
      eq(activity.businessId, tx.businessId),
      eq(activity.kind, "ro.released"),
      eq(activity.subjectType, "job"),
      eq(activity.subjectId, jobId),
    )).limit(1);
    if (prior) return { id: jobId, message: "Vehicle already marked released." };
    await recordActivity(tx, {
      kind: "ro.released",
      subjectType: "job",
      subjectId: jobId,
      summary: "Invoice paid; vehicle released and repair order closed",
      recordedAtNow: true,
    });
    await audit(tx, meta, {
      action: "ro.released", targetType: "job", targetId: jobId,
      after: { balanceCents: flow.balanceCents },
    });
    return { id: jobId, message: "Vehicle released and RO closed." };
  },
});
