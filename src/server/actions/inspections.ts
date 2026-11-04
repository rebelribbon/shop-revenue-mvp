"use server";
import { z } from "zod";
import {
  addInspectionToJob,
  inspectionItems,
  saveInspection,
} from "@/domain/inspections";
import { defineShopAction } from "./define";

export const saveInspectionAction = defineShopAction({
  name: "saveInspection",
  input: z.object({ jobId: z.uuid(), items: z.string().max(100000) }),
  run: ({ tx, meta }, i) =>
    saveInspection(tx, meta, {
      jobId: i.jobId,
      items: inspectionItems.parse(JSON.parse(i.items)),
    }),
  persist: (r) => ({
    ...r,
    message: r.complete
      ? "Inspection saved. Every item is checked."
      : "Inspection saved.",
  }),
});

export const addInspectionToJobAction = defineShopAction({
  name: "addInspectionToJob",
  input: z.object({ jobId: z.uuid() }),
  run: ({ tx, meta }, i) => addInspectionToJob(tx, meta, i.jobId),
  persist: (r) => ({
    ...r,
    message: `Added ${r.added} item${r.added === 1 ? "" : "s"} to the estimate.`,
  }),
});
