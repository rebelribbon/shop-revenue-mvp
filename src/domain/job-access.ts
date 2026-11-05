import type { TenantTx } from "@/db/tenant";
import { notFound } from "@/lib/errors";
import { and, eq } from "drizzle-orm";
import { file, jobMedia } from "@/db/schema";
import { getJob, listJobs } from "./jobs";

export async function requireAssignedJob(
  tx: TenantTx,
  input: { jobId?: string },
) {
  if (!input.jobId || !(await getJob(tx, input.jobId)))
    throw notFound("That assigned job");
}

export async function requireAssignedCustomer(
  tx: TenantTx,
  input: { customerId: string },
) {
  if (
    !(await listJobs(tx)).some(
      (j) => (j.data as { customerId: string }).customerId === input.customerId,
    )
  )
    throw notFound("That assigned customer");
}
export async function requireAssignedUpload(
  tx: TenantTx,
  input: { jobId?: string; customerId: string; fileId: string },
) {
  await requireAssignedJob(tx, input);
  const j = await getJob(tx, input.jobId!);
  const [f] = await tx
    .select()
    .from(file)
    .where(
      and(
        eq(file.businessId, tx.businessId),
        eq(file.id, input.fileId),
        eq(file.createdByUserId, tx.actor.id!),
      ),
    );
  if (!f || (j!.data as { customerId: string }).customerId !== input.customerId)
    throw notFound("That upload");
}
export async function requireAssignedMedia(
  tx: TenantTx,
  input: { mediaId: string; jobId?: string },
) {
  const [media] = await tx
    .select()
    .from(jobMedia)
    .where(
      and(
        eq(jobMedia.businessId, tx.businessId),
        eq(jobMedia.id, input.mediaId),
      ),
    );
  await requireAssignedJob(tx, { jobId: media?.jobId ?? undefined });
  if (input.jobId) await requireAssignedJob(tx, input);
}
export async function requireAssignedNote(
  tx: TenantTx,
  input: { jobId?: string; customerId: string },
) {
  await requireAssignedJob(tx, input);
  const j = await getJob(tx, input.jobId!);
  if ((j!.data as { customerId: string }).customerId !== input.customerId)
    throw notFound("That assigned customer");
}
