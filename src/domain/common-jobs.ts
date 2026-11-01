import { and, asc, eq } from "drizzle-orm";
import { commonJob } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { assertOwner } from "./membership";
import { audit, type RequestMeta } from "./records";
import { jobInput } from "./jobs";
import { z } from "zod";
export const commonJobInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    parts: jobInput.shape.parts,
    labor: jobInput.shape.labor,
  })
  .refine((v) => v.parts.length + v.labor.length > 0, "Add at least one item.");
export async function listCommonJobs(tx: TenantTx) {
  return tx
    .select()
    .from(commonJob)
    .where(
      and(eq(commonJob.businessId, tx.businessId), eq(commonJob.active, true)),
    )
    .orderBy(asc(commonJob.name));
}
export async function saveCommonJob(
  tx: TenantTx,
  meta: RequestMeta,
  raw: z.infer<typeof commonJobInput>,
) {
  await assertOwner(tx);
  const input = commonJobInput.parse(raw);
  const strip = <T extends { recommendationId?: string }>(line: T) => {
    const copy = { ...line };
    delete copy.recommendationId;
    return copy;
  };
  const [saved] = await tx
    .insert(commonJob)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      name: input.name,
      parts: input.parts.map(strip),
      labor: input.labor.map(strip),
    })
    .returning({ id: commonJob.id });
  await audit(tx, meta, {
    action: "common_job.saved",
    targetType: "common_job",
    targetId: saved.id,
  });
  return saved;
}
export async function archiveCommonJob(
  tx: TenantTx,
  meta: RequestMeta,
  id: string,
) {
  await assertOwner(tx);
  await tx
    .update(commonJob)
    .set({ active: false })
    .where(and(eq(commonJob.businessId, tx.businessId), eq(commonJob.id, id)));
  await audit(tx, meta, {
    action: "common_job.archived",
    targetType: "common_job",
    targetId: id,
  });
  return { id };
}
