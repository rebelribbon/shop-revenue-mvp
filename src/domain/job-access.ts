import type { TenantTx } from "@/db/tenant";
import { notFound } from "@/lib/errors";
import { and, eq, sql } from "drizzle-orm";
import { file, jobMedia } from "@/db/schema";
import { getJob } from "./jobs";

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
  const result = await tx.execute(sql`select 1 from app.job_assignment a
    where a.business_id=${tx.businessId} and a.user_id=${tx.actor.id}
    and (exists(select 1 from app.activity j where j.business_id=a.business_id
      and j.subject_id=a.job_id and j.kind='job.costed' and j.subject_type='job'
      and j.data->>'customerId'=${input.customerId})
    or exists(select 1 from app.estimate_version e where e.business_id=a.business_id
      and e.quote_id=a.job_id and e.customer_id=${input.customerId}::uuid)) limit 1`);
  if (!result.rows.length) throw notFound("That assigned customer");
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
