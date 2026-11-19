// Durable per-line technician progress. These records belong to one
// customer-authorized estimate version and are never simulated in the browser.
import { and, asc, eq, inArray } from "drizzle-orm";
import { activity } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError, notFound } from "@/lib/errors";
import { loadJobWorkflows, recordJobProgress } from "./job-workflow";
import { getJob } from "./jobs";
import { recordActivity, type RequestMeta } from "./records";

export type RepairState = {
  lines: Record<string, { started: boolean; done: boolean; notes: string }>;
  qualityCheck: boolean;
  postRepairNotes: string;
};
const empty = (): RepairState => ({
  lines: {}, qualityCheck: false, postRepairNotes: "",
});
export async function getTechnicianRepairs(tx: TenantTx, jobIds: string[]) {
  const result = new Map<string, RepairState>();
  if (!jobIds.length) return result;
  const rows = await tx
    .select({ subjectId: activity.subjectId, kind: activity.kind, data: activity.data })
    .from(activity)
    .where(and(
      eq(activity.businessId, tx.businessId),
      eq(activity.subjectType, "job"),
      inArray(activity.subjectId, jobIds),
      inArray(activity.kind, ["technician.repair_line", "technician.final_qa"]),
    ))
    .orderBy(asc(activity.occurredAt), asc(activity.id));
  for (const row of rows) {
    const state = result.get(row.subjectId) ?? empty();
    const raw = row.data as Record<string, unknown>;
    if (row.kind === "technician.repair_line" && typeof raw.lineId === "string") {
      state.lines[raw.lineId] = {
        started: raw.started === true,
        done: raw.done === true,
        notes: typeof raw.notes === "string" ? raw.notes : "",
      };
    } else if (row.kind === "technician.final_qa") {
      state.qualityCheck = raw.qualityCheck === true;
      state.postRepairNotes =
        typeof raw.postRepairNotes === "string" ? raw.postRepairNotes : "";
    }
    result.set(row.subjectId, state);
  }
  return result;
}
async function authorizedFlow(tx: TenantTx, jobId: string, versionId: string) {
  const job = await getJob(tx, jobId);
  if (!job) throw notFound("That repair order");
  const flow = (await loadJobWorkflows(tx, [jobId])).get(jobId);
  if (!flow?.latest?.authorization || flow.latest.estimate.id !== versionId)
    throw new AppError("INVALID_TRANSITION", "Use the current customer-signed estimate before working on this RO.");
  return flow;
}
export async function saveRepairLine(
  tx: TenantTx,
  meta: RequestMeta,
  input: { jobId: string; versionId: string; lineId: string; started: boolean; done: boolean; notes: string },
) {
  const flow = await authorizedFlow(tx, input.jobId, input.versionId);
  if (!flow.approved.some((line) => line.id === input.lineId))
    throw new AppError("FORBIDDEN", "That repair was not approved by the customer.");
  if (input.done && (!input.started || !input.notes.trim()))
    throw new AppError("VALIDATION", "Start the authorized repair and record your work notes before marking it complete.");
  if (flow.work === "completed")
    throw new AppError("INVALID_TRANSITION", "This repair order is already marked complete.");
  // Starting the first approved line opens the RO for authorized technician work.
  if (input.started && flow.work === "not_recorded")
    await recordJobProgress(tx, meta, {
      jobId: input.jobId, versionId: input.versionId,
      expectedStatus: "not_recorded", status: "in_progress", note: "Technician began authorized repair.",
    });
  await recordActivity(tx, {
    kind: "technician.repair_line", subjectType: "job", subjectId: input.jobId,
    summary: `Authorized repair ${input.done ? "completed" : input.started ? "in progress" : "reopened"}`,
    data: input, recordedAtNow: true,
  });
  return { message: input.done ? "Repair work saved as complete." : "Repair work saved." };
}
export async function saveRepairQa(
  tx: TenantTx,
  input: { jobId: string; versionId: string; qualityCheck: boolean; postRepairNotes: string },
) {
  const flow = await authorizedFlow(tx, input.jobId, input.versionId);
  if (flow.work === "completed")
    throw new AppError("INVALID_TRANSITION", "Completed ROs cannot have their final QA replaced.");
  await recordActivity(tx, {
    kind: "technician.final_qa", subjectType: "job", subjectId: input.jobId,
    summary: "Technician final QA recorded",
    data: input, recordedAtNow: true,
  });
  return { message: "Final quality check saved." };
}
export async function submitCompletedRepairs(
  tx: TenantTx,
  meta: RequestMeta,
  input: { jobId: string; versionId: string },
) {
  const flow = await authorizedFlow(tx, input.jobId, input.versionId);
  if (flow.work !== "in_progress")
    throw new AppError("INVALID_TRANSITION", "Start the authorized repairs before completing the RO.");
  const state = (await getTechnicianRepairs(tx, [input.jobId])).get(input.jobId) ?? empty();
  if (!flow.approved.length ||
      flow.approved.some((line) => !state.lines[line.id]?.done || !state.lines[line.id]?.notes.trim()))
    throw new AppError("VALIDATION", "Finish and document every authorized repair first.");
  if (!state.qualityCheck || !state.postRepairNotes.trim())
    throw new AppError("VALIDATION", "Complete the final QA check and its notes before submitting.");
  return recordJobProgress(tx, meta, {
    jobId: input.jobId, versionId: input.versionId,
    expectedStatus: "in_progress", status: "completed", note: state.postRepairNotes,
  });
}
