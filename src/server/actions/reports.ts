"use server";
import { z } from "zod";
import {
  readConfig,
  saveReport,
  updateSavedReport,
} from "@/domain/report-builder";
import { defineShopAction } from "./define";

export const saveReportAction = defineShopAction({
  name: "saveReport",
  ownerOnly: true,
  input: z.object({
    name: z.string().trim().min(1, "Name this report.").max(120),
    source: z.string(),
    group: z.string(),
    measures: z.string(),
    range: z.string(),
    view: z.string(),
    pinned: z.literal("on").optional(),
  }),
  run: ({ tx, meta }, i) =>
    saveReport(tx, meta, {
      name: i.name,
      config: readConfig(i),
      pinned: i.pinned === "on",
    }),
  persist: (r) => ({ ...r, message: "Report saved." }),
});

export const updateSavedReportAction = defineShopAction({
  name: "updateSavedReport",
  ownerOnly: true,
  input: z.object({
    id: z.uuid(),
    action: z.enum(["pin", "unpin", "remove"]),
  }),
  run: ({ tx, meta }, i) => updateSavedReport(tx, meta, i),
  persist: (r) => ({ ...r, message: "Report updated." }),
});
