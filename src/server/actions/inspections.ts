"use server";
import { z } from "zod";
import {
  addInspectionToJob,
  inspectionItems,
  inspectionAssessmentInput,
  saveInspection,
} from "@/domain/inspections";
import { requireAssignedJob } from "@/domain/job-access";
import { prepareHandoffPing, sendHandoffPing } from "@/domain/handoff-pings";
import { defineShopAction } from "./define";

export const saveInspectionAction = defineShopAction({
  name: "saveInspection",
  technicianAccess: requireAssignedJob,
  input: z.object({
    jobId: z.uuid(),
    items: z.string().max(100000),
    submit: z.boolean().optional(),
    assessment: inspectionAssessmentInput.optional(),
  }),
  run: async ({ tx, meta }, i) => {
    const r = await saveInspection(tx, meta, {
      jobId: i.jobId,
      items: inspectionItems.parse(JSON.parse(i.items)),
      submit: i.submit,
      assessment: i.assessment,
    });
    return {
      ...r,
      message: r.complete
        ? r.advisorNotified
          ? "Inspection submitted. Your advisor has been notified in Tasks."
          : "Inspection submitted. No assigned-advisor handoff was available; ask the front office to review."
        : "Inspection saved.",
      // The advisor is emailed after this commits.
      ping: r.advisorNotified ? await prepareHandoffPing(tx, i.jobId) : null,
    };
  },
  // The stored replay never keeps the email itself.
  persist: (r) => ({ ...r, ping: null }),
  afterCommit: async ({ ping, ...r }) => {
    const emailed = await sendHandoffPing(ping);
    return {
      ...r,
      message: emailed
        ? "Inspection submitted. Your advisor has been notified in Tasks and by email."
        : r.message,
    };
  },
});

export const addInspectionToJobAction = defineShopAction({
  name: "addInspectionToJob",
  // Pricing/estimate editing belongs to the advisor, never the technician.
  // No technicianAccess grants a server-side FORBIDDEN response to that role.
  input: z.object({ jobId: z.uuid() }),
  run: ({ tx, meta }, i) => addInspectionToJob(tx, meta, i.jobId),
  persist: (r) => ({
    ...r,
    message: `Added ${r.added} item${r.added === 1 ? "" : "s"} to the estimate.`,
  }),
});
