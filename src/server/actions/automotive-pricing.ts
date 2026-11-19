"use server";
import { z } from "zod";
import { AppError, notFound } from "@/lib/errors";
import { createJob, getJob, jobInput } from "@/domain/jobs";
import { getInspection } from "@/domain/inspections";
import { loadJobWorkflows } from "@/domain/job-workflow";
import { defineShopAction } from "./define";

const pricedInput = z.object({
  jobId: z.uuid(),
  expectedVersion: z.uuid(),
});

const moneyCents = z.number().int().min(0).max(100000000);

/**
 * The approved Automotive pricing panel edits the existing costed RO.
 * The client cannot change customer, vehicle, versions or existing line data:
 * each write reconstructs the new job revision from the tenant-scoped DB.
 */
export const addAutomotiveRecommendationAction = defineShopAction({
  name: "addAutomotiveRecommendation",
  input: pricedInput
    .extend({
      description: z.string().trim().min(1).max(200),
      partsCents: moneyCents,
      laborCents: moneyCents,
      costCents: moneyCents,
    })
    .refine((i) => i.partsCents + i.laborCents > 0, {
      message: "Enter a parts or labor selling price.",
    }),
  run: async ({ tx }, i) => {
    const job = await editableJob(tx, i.jobId, i.expectedVersion);
    const data = jobInput.parse(job.data);
    const total = i.partsCents + i.laborCents;
    // Distribute combined internal cost proportionately; total remains exact.
    const partCost = i.partsCents
      ? Math.round((i.costCents * i.partsCents) / total)
      : 0;
    const laborCost = i.costCents - partCost;
    const description = i.description.trim();
    const next = {
      ...data,
      jobId: i.jobId,
      expectedVersion: job.version,
      parts:
        i.partsCents > 0
          ? [
              ...data.parts,
              {
                description,
                quantity: 1,
                unitCostCents: partCost,
                unitPriceCents: i.partsCents,
              },
            ]
          : data.parts,
      labor:
        i.laborCents > 0
          ? [
              ...data.labor,
              {
                description,
                estimatedHoursHundredths: 100,
                actualHoursHundredths: null,
                sellRateCents: i.laborCents,
                costRateCents: laborCost,
              },
            ]
          : data.labor,
    };
    await createJob(tx, next);
    return { jobId: i.jobId, message: "Recommendation added to this RO." };
  },
});

export const removeAutomotiveRecommendationAction = defineShopAction({
  name: "removeAutomotiveRecommendation",
  input: pricedInput.extend({ description: z.string().trim().min(1).max(200) }),
  run: async ({ tx }, i) => {
    const job = await editableJob(tx, i.jobId, i.expectedVersion);
    const data = jobInput.parse(job.data);
    const parts = data.parts.filter((p) => p.description !== i.description);
    const labor = data.labor.filter((l) => l.description !== i.description);
    if (
      parts.length === data.parts.length &&
      labor.length === data.labor.length
    )
      throw notFound("That recommendation");
    await createJob(tx, {
      ...data,
      jobId: i.jobId,
      expectedVersion: job.version,
      parts,
      labor,
    });
    return { jobId: i.jobId, message: "Recommendation removed from draft." };
  },
});

async function editableJob(
  tx: Parameters<typeof getJob>[0],
  id: string,
  version: string,
) {
  const job = await getJob(tx, id);
  if (!job) throw notFound("That repair order");
  if (job.version !== version)
    throw new AppError("CONFLICT", "This RO changed. Reload before pricing.");
  const data = jobInput.parse(job.data);
  if (!data.inspectionFirst)
    throw new AppError(
      "VALIDATION",
      "Only inspected Automotive ROs can use this pricing screen.",
    );
  const inspection = await getInspection(tx, id);
  if (!inspection.complete)
    throw new AppError(
      "INVALID_TRANSITION",
      "Submit the technician inspection before pricing.",
    );
  const flow = (await loadJobWorkflows(tx, [id])).get(id);
  if (flow?.stage !== "draft")
    throw new AppError(
      "INVALID_TRANSITION",
      "The estimate is already finalized. Use a supplement to revise authorized work.",
    );
  return job;
}
