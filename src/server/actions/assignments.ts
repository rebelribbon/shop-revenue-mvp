"use server";
import { z } from "zod";
import { assignJob, assignVisit } from "@/domain/assignments";
import { defineShopAction } from "./define";

// "" from the picker means nobody.
const who = z
  .union([z.uuid(), z.literal("")])
  .transform((v) => (v === "" ? null : v));

export const assignJobAction = defineShopAction({
  name: "assignJob",
  input: z.object({ jobId: z.uuid(), userId: who }),
  run: async ({ tx, meta }, i) => {
    const r = await assignJob(tx, meta, i);
    return {
      ...r,
      message: r.tech ? `${r.tech} is on this job.` : "Nobody is on this job.",
    };
  },
});

export const assignVisitAction = defineShopAction({
  name: "assignVisit",
  input: z.object({ appointmentId: z.uuid(), userId: who }),
  run: async ({ tx, meta }, i) => {
    const r = await assignVisit(tx, meta, i);
    return {
      ...r,
      message: r.tech
        ? `${r.tech} is on this visit.`
        : "Nobody is on this visit.",
    };
  },
});
