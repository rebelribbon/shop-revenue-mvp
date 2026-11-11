import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { currentMemberRole } from "./membership";
import { AppError } from "@/lib/errors";
import { z } from "zod";
import {
  activity,
  customer,
  estimateVersion,
  jobAssignment,
  recommendation,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import {
  validateRecoverySource,
  validateContactSource,
  validateAppointmentSource,
} from "./recovery-source";
import { recordActivity } from "./records";
import { getCustomerWithVehicles, getVehicle } from "./customers";
import { serviceAssetLabel } from "./service-assets";
import { calculateJob } from "./job-costing";
import { repeatInput } from "@/lib/service-plans";
const amount = z.number().int().min(0).max(100000000);
export const jobInput = z.object({
  jobId: z.uuid().optional(),
  sourceRecoveryItemId: z.uuid().optional(),
  sourceContactActivityId: z.uuid().optional(),
  sourceAppointmentId: z.uuid().optional(),
  expectedVersion: z.uuid().optional(),
  customerId: z.uuid(),
  vehicleId: z.uuid().optional(),
  serviceAssetId: z.uuid().optional(),
  title: z.string().trim().min(1).max(200),
  // Recurring work; absent for a one-time job.
  repeat: repeatInput.nullable().optional(),
  // Warranty on this work, in months (shown on the estimate and invoice).
  warrantyMonths: z.number().int().min(1).max(120).nullable().optional(),
  parts: z
    .array(
      z.object({
        recommendationId: z.uuid().optional(),
        // From the parts catalog: stock comes off when it's invoiced.
        partItemId: z.uuid().optional(),
        description: z.string().trim().min(1).max(200),
        quantity: z
          .number()
          .min(0.01)
          .max(10000)
          .refine(
            (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6,
            "Use at most two decimal places for quantity.",
          ),
        // null = cost not entered yet (profit stays unknown, never $0 cost).
        unitCostCents: amount.nullable(),
        unitPriceCents: amount,
        taxable: z.boolean().optional(),
      }),
    )
    .max(100),
  labor: z
    .array(
      z.object({
        recommendationId: z.uuid().optional(),
        description: z.string().trim().min(1).max(200),
        estimatedHoursHundredths: amount.max(100000),
        actualHoursHundredths: amount.max(100000).nullable(),
        sellRateCents: amount,
        costRateCents: amount.nullable(),
        taxable: z.boolean().optional(),
      }),
    )
    .max(100),
});
export type JobInput = z.infer<typeof jobInput>;
export async function createJob(tx: TenantTx, input: JobInput) {
  const data = jobInput.parse(input);
  if ((await currentMemberRole(tx)) === "technician")
    throw new AppError(
      "FORBIDDEN",
      "Ask the service advisor to create or price repair orders.",
    );
  await getCustomerWithVehicles(tx, data.customerId);
  if (Boolean(data.vehicleId) === Boolean(data.serviceAssetId))
    throw new AppError(
      "VALIDATION",
      "Choose either a vehicle or a property/equipment item.",
    );
  if (data.vehicleId) await getVehicle(tx, data.customerId, data.vehicleId);
  if (data.serviceAssetId)
    await serviceAssetLabel(tx, data.customerId, data.serviceAssetId);
  await validateRecoverySource(
    tx,
    data.sourceRecoveryItemId,
    data.customerId,
    data.vehicleId,
    data.serviceAssetId,
  );
  await validateContactSource(
    tx,
    data.sourceContactActivityId,
    data.sourceRecoveryItemId,
  );
  await validateAppointmentSource(
    tx,
    data.sourceAppointmentId,
    data.customerId,
    data.vehicleId,
    data.sourceRecoveryItemId,
    data.sourceContactActivityId,
    data.serviceAssetId,
  );
  for (const line of [...data.parts, ...data.labor])
    if (line.recommendationId) {
      const [rec] = await tx
        .select()
        .from(recommendation)
        .where(
          and(
            eq(recommendation.businessId, tx.businessId),
            eq(recommendation.id, line.recommendationId),
            eq(recommendation.customerId, data.customerId),
            data.vehicleId
              ? eq(recommendation.vehicleId, data.vehicleId)
              : sql`${recommendation.vehicleId} IS NULL`,
          ),
        );
      if (rec && data.serviceAssetId && rec.sourceVersionId) {
        const [origin] = await tx
          .select({ serviceAssetId: estimateVersion.serviceAssetId })
          .from(estimateVersion)
          .where(
            and(
              eq(estimateVersion.businessId, tx.businessId),
              eq(estimateVersion.id, rec.sourceVersionId),
            ),
          );
        if (origin?.serviceAssetId !== data.serviceAssetId)
          throw new AppError(
            "VALIDATION",
            "The declined work belongs to a different property or equipment item.",
          );
      }
      if (!rec)
        throw new AppError(
          "VALIDATION",
          "The declined-work link must belong to this customer and vehicle.",
        );
    }
  const totals = calculateJob(data.parts, data.labor);
  const id = data.jobId ?? crypto.randomUUID();
  if (data.jobId) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${id},0))`,
    );
    const [prior] = await tx
      .select({ version: activity.id, data: activity.data })
      .from(activity)
      .where(
        and(
          eq(activity.businessId, tx.businessId),
          eq(activity.subjectId, id),
          eq(activity.kind, "job.costed"),
        ),
      )
      .orderBy(desc(activity.occurredAt), desc(activity.id))
      .limit(1);
    if (!prior || prior.version !== data.expectedVersion)
      throw new AppError(
        "CONFLICT",
        "Job changed. Refresh before revising it.",
      );
    const original = jobInput.parse(prior.data);
    if (
      original.customerId !== data.customerId ||
      original.vehicleId !== data.vehicleId ||
      original.serviceAssetId !== data.serviceAssetId ||
      original.sourceRecoveryItemId !== data.sourceRecoveryItemId ||
      original.sourceContactActivityId !== data.sourceContactActivityId ||
      original.sourceAppointmentId !== data.sourceAppointmentId
    )
      throw new AppError(
        "VALIDATION",
        "Create a new job to change its customer or vehicle.",
      );
  }
  await recordActivity(tx, {
    kind: "job.costed",
    subjectType: "job",
    subjectId: id,
    summary: data.title,
    data: { ...data, totals },
  });
  await recordActivity(tx, {
    kind: "job.created",
    subjectType: data.vehicleId ? "vehicle" : "customer",
    subjectId: data.vehicleId ?? data.customerId,
    summary: `Job costed: ${data.title}`,
    data: { jobId: id },
  });
  return { id };
}
export async function getJob(tx: TenantTx, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  if ((await currentMemberRole(tx)) === "technician") {
    const [assignment] = await tx
      .select()
      .from(jobAssignment)
      .where(
        and(
          eq(jobAssignment.businessId, tx.businessId),
          eq(jobAssignment.jobId, id),
          eq(jobAssignment.userId, tx.actor.id!),
        ),
      );
    if (!assignment) return null;
  }
  const [job] = await tx
    .select({
      version: activity.id,
      id: activity.subjectId,
      title: activity.summary,
      data: activity.data,
      createdAt: activity.occurredAt,
    })
    .from(activity)
    .where(
      and(
        eq(activity.businessId, tx.businessId),
        eq(activity.kind, "job.costed"),
        eq(activity.subjectType, "job"),
        eq(activity.subjectId, id),
      ),
    )
    .orderBy(desc(activity.occurredAt), desc(activity.id))
    .limit(1);
  if (job) return { ...job, documentOnly: false };
  return (await documentJobs(tx, id))[0] ?? null;
}
export async function listJobs(
  tx: TenantTx,
  query = "",
  assigneeUserId?: string,
) {
  if ((await currentMemberRole(tx)) === "technician")
    assigneeUserId = tx.actor.id!;
  const latest = tx
    .selectDistinctOn([activity.subjectId], {
      version: activity.id,
      id: activity.subjectId,
      title: activity.summary,
      data: activity.data,
      createdAt: activity.occurredAt,
    })
    .from(activity)
    .where(
      and(
        eq(activity.businessId, tx.businessId),
        eq(activity.kind, "job.costed"),
        eq(activity.subjectType, "job"),
      ),
    )
    .orderBy(activity.subjectId, desc(activity.occurredAt), desc(activity.id))
    .as("latest_jobs");
  const pattern = `%${query
    .trim()
    .slice(0, 100)
    .replace(/[\\%_]/g, "\\$&")}%`;
  const costed = await tx
    .select()
    .from(latest)
    .where(
      and(
        query.trim()
          ? or(
              ilike(latest.title, pattern),
              sql`exists(select 1 from ${customer} where ${customer.businessId}=${tx.businessId} and ${customer.id}::text=${latest.data}->>'customerId' and ${customer.displayName} ilike ${pattern})`,
            )
          : undefined,
        assigneeUserId
          ? sql`exists(select 1 from ${jobAssignment} where ${jobAssignment.businessId}=${tx.businessId} and ${jobAssignment.jobId}=${latest.id} and ${jobAssignment.userId}=${assigneeUserId})`
          : undefined,
      ),
    )
    .orderBy(desc(latest.createdAt), desc(latest.version))
    .limit(100);
  const documents = await documentJobs(tx, undefined, query, assigneeUserId);
  return [...costed.map((j) => ({ ...j, documentOnly: false })), ...documents]
    .sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() ||
        b.version.localeCompare(a.version),
    )
    .slice(0, 100);
}

// Older imported estimates can have no job.costed activity. Read their frozen
// documents without inventing a cost history or modifying customer evidence.
async function documentJobs(
  tx: TenantTx,
  id?: string,
  query = "",
  assignee?: string,
) {
  const pattern = `%${query
    .trim()
    .slice(0, 100)
    .replace(/[\\%_]/g, "\\$&")}%`;
  const latest = tx
    .selectDistinctOn([estimateVersion.quoteId])
    .from(estimateVersion)
    .where(
      and(
        eq(estimateVersion.businessId, tx.businessId),
        id ? eq(estimateVersion.quoteId, id) : undefined,
        sql`not exists(select 1 from ${activity} where ${activity.businessId}=${tx.businessId} and ${activity.subjectId}=${estimateVersion.quoteId} and ${activity.kind}='job.costed' and ${activity.subjectType}='job')`,
        query.trim()
          ? sql`(${estimateVersion.snapshot}->>'title' ilike ${pattern} or ${estimateVersion.snapshot}->>'customerName' ilike ${pattern})`
          : undefined,
        assignee
          ? sql`exists(select 1 from ${jobAssignment} where ${jobAssignment.businessId}=${tx.businessId} and ${jobAssignment.jobId}=${estimateVersion.quoteId} and ${jobAssignment.userId}=${assignee})`
          : undefined,
      ),
    )
    .orderBy(estimateVersion.quoteId, desc(estimateVersion.version))
    .as("document_jobs");
  const rows = await tx
    .select()
    .from(latest)
    .orderBy(desc(latest.createdAt), desc(latest.id))
    .limit(100);
  return rows.map((v) => ({
    id: v.quoteId,
    version: v.id,
    title: v.snapshot.title,
    createdAt: v.createdAt,
    documentOnly: true,
    data: {
      customerId: v.customerId,
      vehicleId: v.vehicleId ?? undefined,
      serviceAssetId: v.serviceAssetId ?? undefined,
      title: v.snapshot.title,
      parts: v.snapshot.lines
        .filter((l) => l.kind === "part")
        .map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          unitCostCents: null,
          taxable: l.taxable,
        })),
      labor: v.snapshot.lines
        .filter((l) => l.kind === "labor")
        .map((l) => ({
          description: l.description,
          estimatedHoursHundredths: Math.round(l.quantity * 100),
          actualHoursHundredths: null,
          sellRateCents: l.unitPriceCents,
          costRateCents: null,
          taxable: l.taxable,
        })),
    },
  }));
}
