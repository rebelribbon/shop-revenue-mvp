"use server";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { canManageTeam, currentMemberRole } from "@/domain/membership";
import { requireAssignedJob } from "@/domain/job-access";
import {
  saveRepairLine, saveRepairQa, submitCompletedRepairs,
} from "@/domain/technician-repairs";
import { prepareHandoffPing, sendHandoffPing } from "@/domain/handoff-pings";
import { defineShopAction } from "./define";

const jobVersion = z.object({ jobId: z.uuid(), versionId: z.uuid() });
async function authorizeTechnician(tx: Parameters<typeof currentMemberRole>[0]) {
  const role = await currentMemberRole(tx);
  if (role === "staff" && !(await canManageTeam(tx)))
    throw new AppError("FORBIDDEN", "Only the assigned technician or a shop manager can record repair work.");
}
export const saveAutomotiveRepairLineAction = defineShopAction({
  name: "saveAutomotiveRepairLine",
  technicianAccess: requireAssignedJob,
  input: jobVersion.extend({
    lineId: z.uuid(),
    started: z.boolean(),
    done: z.boolean(),
    notes: z.string().max(2000),
  }),
  run: async ({ tx, meta }, input) => {
    await authorizeTechnician(tx);
    return saveRepairLine(tx, meta, input);
  },
});
export const saveAutomotiveRepairQaAction = defineShopAction({
  name: "saveAutomotiveRepairQa",
  technicianAccess: requireAssignedJob,
  input: jobVersion.extend({
    qualityCheck: z.boolean(),
    postRepairNotes: z.string().max(2000),
  }),
  run: async ({ tx }, input) => {
    await authorizeTechnician(tx);
    return saveRepairQa(tx, input);
  },
});
export const finishAutomotiveRepairAction = defineShopAction({
  name: "finishAutomotiveRepair",
  technicianAccess: requireAssignedJob,
  input: jobVersion,
  run: async ({ tx, meta }, input) => {
    await authorizeTechnician(tx);
    const r = await submitCompletedRepairs(tx, meta, input);
    return { ...r, ping: r.handoff ? await prepareHandoffPing(tx, input.jobId) : null };
  },
  persist: (r) => ({ ...r, ping: null }),
  afterCommit: async ({ ping, ...r }) => {
    const sent = await sendHandoffPing(ping);
    return { ...r, message: sent ? `${r.message} The advisor was emailed.` : r.message };
  },
});
