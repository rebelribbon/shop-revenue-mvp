// Draft inspections stay editable until explicit submission. Submitted findings
// are frozen in the tenant activity ledger before the assigned advisor is notified.
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { activity, inspection } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError, notFound } from "@/lib/errors";
import {
  inspectionTemplate,
  type InspectionItem,
  type InspectionAssessment,
} from "@/lib/inspection-templates";
import { createJob, getJob, jobInput } from "./jobs";
import { audit, recordActivity, type RequestMeta } from "./records";
import { notifyAdvisorInspectionComplete } from "./job-handoffs";

const itemSchema = z.object({
  key: z.string().min(1).max(60),
  label: z.string().trim().min(1).max(120),
  status: z.enum(["good", "watch", "fix", "na", "unchecked"]),
  note: z.string().max(1000).default(""),
  recommendedWork: z.string().max(200).default(""),
  section: z.string().max(100).optional(),
  hint: z.string().max(300).optional(),
  measurements: z
    .partialRecord(
      z.enum(["lf", "rf", "lr", "rr", "spare"]),
      z.string().max(20),
    )
    .optional(),
  hoursHundredths: z.number().int().min(0).max(100000).default(100),
  addedToJob: z.boolean().default(false),
});
export const inspectionItems = z.array(itemSchema).min(1).max(60);
export const inspectionAssessmentInput = z.object({
  diagnosis: z.string().trim().max(4000),
  bay: z.string().trim().max(120),
  vehiclePickedUp: z.boolean(),
});

async function businessType(tx: TenantTx) {
  const r = await tx.execute(
    sql`SELECT business_type FROM app.business WHERE id=${tx.businessId}`,
  );
  return String(r.rows[0]?.business_type ?? "automotive");
}

export async function getInspection(tx: TenantTx, jobId: string) {
  const [row] = await tx
    .select()
    .from(inspection)
    .where(
      and(
        eq(inspection.businessId, tx.businessId),
        eq(inspection.jobId, jobId),
      ),
    );
  const items: InspectionItem[] = row
    ? inspectionItems.parse(row.items)
    : inspectionTemplate(await businessType(tx));
  const count = (s: InspectionItem["status"]) =>
    items.filter((i) => i.status === s).length;
  const [assessmentRow] = await tx
    .select({ data: activity.data })
    .from(activity)
    .where(
      and(
        eq(activity.businessId, tx.businessId),
        eq(activity.subjectId, jobId),
        eq(activity.subjectType, "job"),
        eq(activity.kind, "inspection.assessment"),
      ),
    )
    .orderBy(desc(activity.occurredAt), desc(activity.id))
    .limit(1);
  const parsedAssessment = inspectionAssessmentInput.safeParse(
    assessmentRow?.data,
  );
  const assessment: InspectionAssessment = {
    ...(parsedAssessment.success
      ? parsedAssessment.data
      : { diagnosis: "", bay: "", vehiclePickedUp: false }),
    pickedUpAt:
      typeof (assessmentRow?.data as { pickedUpAt?: unknown })?.pickedUpAt ===
      "string"
        ? (assessmentRow.data as { pickedUpAt: string }).pickedUpAt
        : null,
  };
  return {
    saved: !!row,
    complete: !!row?.completedAt,
    items,
    assessment,
    counts: {
      good: count("good"),
      watch: count("watch"),
      fix: count("fix"),
      unchecked: count("unchecked"),
    },
    pending: items.filter(
      (i) =>
        (i.status === "fix" || i.status === "watch") &&
        !!i.recommendedWork?.trim() &&
        !i.addedToJob,
    ),
  };
}

export async function saveInspection(
  tx: TenantTx,
  meta: RequestMeta,
  input: {
    jobId: string;
    items: InspectionItem[];
    submit?: boolean;
    assessment?: z.infer<typeof inspectionAssessmentInput>;
  },
) {
  // Serialize drafts, submissions and recommendation imports for this RO.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${input.jobId},0))`,
  );
  if (!(await getJob(tx, input.jobId))) throw notFound("That job");
  const current = await getInspection(tx, input.jobId);
  if (current.complete)
    throw new AppError(
      "INVALID_TRANSITION",
      "This inspection has been submitted. Its recorded findings cannot be overwritten.",
    );
  const assessment = inspectionAssessmentInput.parse(
    input.assessment ?? current.assessment,
  );
  const pickedUpAt = assessment.vehiclePickedUp
    ? (current.assessment.pickedUpAt ?? new Date().toISOString())
    : null;
  if (
    input.submit === true &&
    (!assessment.vehiclePickedUp || !assessment.bay || !assessment.diagnosis)
  )
    throw new AppError(
      "VALIDATION",
      "Confirm pickup, record the bay or work area, and enter your diagnosis before submitting.",
    );
  const submitted = inspectionItems.parse(input.items);
  const byKey = new Map(submitted.map((item) => [item.key, item]));
  if (
    submitted.length !== current.items.length ||
    byKey.size !== submitted.length ||
    current.items.some((item) => !byKey.has(item.key))
  )
    throw new AppError(
      "VALIDATION",
      "Keep every checkpoint in this inspection. Refresh and complete the full checklist.",
    );
  // Checkpoint names and estimate-import flags belong to the server. A client
  // cannot omit a bad result, rename a point or pretend work is already priced.
  const items = current.items.map((original) => {
    const item = byKey.get(original.key)!;
    return {
      ...item,
      key: original.key,
      label: original.label,
      section: original.section,
      hint: original.hint,
      hoursHundredths: original.hoursHundredths,
      addedToJob: original.addedToJob,
    };
  });
  const allChecked = items.every((i) => i.status !== "unchecked");
  const done = input.submit === true && allChecked;
  if (input.submit === true && !allChecked)
    throw new AppError(
      "VALIDATION",
      "Complete every inspection point before submitting.",
    );
  if (
    input.submit === true &&
    items.some(
      (i) =>
        ((i.status === "watch" || i.status === "fix") && !i.note.trim()) ||
        (i.status === "fix" && !i.recommendedWork?.trim()),
    )
  ) {
    throw new AppError(
      "VALIDATION",
      "Service Soon requires findings; Service Now requires findings and recommended work.",
    );
  }
  await tx
    .insert(inspection)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      jobId: input.jobId,
      items,
      completedAt: done ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: [inspection.businessId, inspection.jobId],
      set: { items, completedAt: done ? new Date() : null },
    });
  await recordActivity(tx, {
    kind: "inspection.assessment",
    subjectType: "job",
    subjectId: input.jobId,
    summary: done
      ? "Technician diagnosis submitted"
      : "Technician assessment progress saved",
    data: { ...assessment, pickedUpAt },
    recordedAtNow: true,
  });
  if (done) {
    await recordActivity(tx, {
      kind: "inspection.submitted",
      subjectType: "job",
      subjectId: input.jobId,
      summary: "Inspection submitted to the assigned advisor",
      data: { items, assessment: { ...assessment, pickedUpAt } },
      recordedAtNow: true,
    });
    await notifyAdvisorInspectionComplete(tx, input.jobId);
  }
  await audit(tx, meta, {
    action: "inspection.saved",
    targetType: "job",
    targetId: input.jobId,
    after: {
      fix: items.filter((i) => i.status === "fix").length,
      watch: items.filter((i) => i.status === "watch").length,
    },
  });
  return { jobId: input.jobId, complete: done };
}

// Turn "Needs work" items into labor lines on the job, priced at the
// shop's labor rate. Each item is added once.
export async function addInspectionToJob(
  tx: TenantTx,
  meta: RequestMeta,
  jobId: string,
) {
  const job = await getJob(tx, jobId);
  if (!job) throw notFound("That job");
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${jobId},0))`,
  );
  const current = await getInspection(tx, jobId);
  if (!current.complete)
    throw new AppError(
      "INVALID_TRANSITION",
      "Submit the completed inspection before adding recommendations to the estimate.",
    );
  if (!current.pending.length)
    throw new AppError(
      "INVALID_TRANSITION",
      "No inspection recommendations are waiting to be added to the estimate.",
    );
  const [biz] = (
    await tx.execute(
      sql`SELECT labor_sell_rate_cents, labor_cost_rate_cents FROM app.business WHERE id=${tx.businessId}`,
    )
  ).rows;
  const input = jobInput.parse(job.data);
  const sell = Number(biz?.labor_sell_rate_cents ?? 0);
  const cost = Number(biz?.labor_cost_rate_cents ?? 0) || null;
  const added = current.pending.map((i) => ({
    description: (
      i.recommendedWork || (i.note ? `${i.label}: ${i.note}` : i.label)
    ).slice(0, 200),
    estimatedHoursHundredths: i.hoursHundredths || 100,
    actualHoursHundredths: null,
    sellRateCents: sell,
    costRateCents: cost,
  }));
  await createJob(tx, {
    ...input,
    jobId: job.id,
    expectedVersion: job.version,
    labor: [...input.labor, ...added],
  } as Parameters<typeof createJob>[1]);
  const keys = new Set(current.pending.map((i) => i.key));
  // This is advisor bookkeeping only; the frozen submission remains intact.
  await tx
    .update(inspection)
    .set({
      items: current.items.map((i) =>
        keys.has(i.key) ? { ...i, addedToJob: true } : i,
      ),
    })
    .where(
      and(
        eq(inspection.businessId, tx.businessId),
        eq(inspection.jobId, jobId),
      ),
    );
  await audit(tx, meta, {
    action: "inspection.recommendations_added",
    targetType: "job",
    targetId: jobId,
    after: { keys: [...keys] },
  });
  return { added: added.length };
}
