import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { z } from "zod";
import {
  activity,
  customer,
  estimateVersion,
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
  parts: z
    .array(
      z.object({
        recommendationId: z.uuid().optional(),
        description: z.string().trim().min(1).max(200),
        quantity: z
          .number()
          .min(0.01)
          .max(10000)
          .refine(
            (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6,
            "Use at most two decimal places for quantity.",
          ),
        unitCostCents: amount,
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
        costRateCents: amount,
        taxable: z.boolean().optional(),
      }),
    )
    .max(100),
});
export type JobInput = z.infer<typeof jobInput>;
export async function createJob(tx: TenantTx, input: JobInput) {
  const data = jobInput.parse(input);
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
  return job ?? null;
}
export async function listJobs(tx: TenantTx, query = "") {
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
  return tx
    .select()
    .from(latest)
    .where(
      query.trim()
        ? or(
            ilike(latest.title, pattern),
            sql`exists(select 1 from ${customer} where ${customer.businessId}=${tx.businessId} and ${customer.id}::text=${latest.data}->>'customerId' and ${customer.displayName} ilike ${pattern})`,
          )
        : undefined,
    )
    .orderBy(desc(latest.createdAt), desc(latest.version))
    .limit(100);
}
