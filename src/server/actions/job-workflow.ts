"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prepareHandoffPing, sendHandoffPing } from "@/domain/handoff-pings";
import { requireAssignedJob } from "@/domain/job-access";
import { defineShopAction } from "./define";
import { recordJobProgress, recordJobSharing } from "@/domain/job-workflow";

const progress = defineShopAction({
  name: "recordJobProgress",
  technicianAccess: requireAssignedJob,
  input: z.object({
    jobId: z.uuid(),
    versionId: z.uuid(),
    expectedStatus: z.enum(["not_recorded", "in_progress", "completed"]),
    status: z.enum(["in_progress", "completed"]),
    note: z.string().max(1000),
  }),
  run: async ({ tx, meta }, input) => {
    const r = await recordJobProgress(tx, meta, input);
    return {
      ...r,
      // Whoever the RO passed to is emailed after this commits.
      ping: r.handoff ? await prepareHandoffPing(tx, input.jobId) : null,
    };
  },
  persist: (r) => ({ ...r, ping: null }),
  afterCommit: async ({ ping, ...r }) => {
    const emailed = await sendHandoffPing(ping);
    return {
      ...r,
      message: emailed ? `${r.message} They’ve been emailed.` : r.message,
    };
  },
});
const sharing = defineShopAction({
  name: "recordJobSharing",
  input: z.object({
    jobId: z.uuid(),
    documentId: z.uuid(),
    kind: z.enum(["estimate", "invoice"]),
  }),
  run: ({ tx, meta }, input) => recordJobSharing(tx, meta, input),
});
export async function recordJobProgressAction(input: unknown) {
  const result = await progress(input);
  if (result.ok) revalidatePath("/app", "layout");
  return result;
}
export async function recordJobSharingAction(input: unknown) {
  const result = await sharing(input);
  if (result.ok) revalidatePath("/app", "layout");
  return result;
}
