// Digital inspections: the tech marks each item Good / Watch / Needs work
// with a note, and "Needs work" items become estimate lines in one tap.
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { inspection } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError, notFound } from "@/lib/errors";
import {
  inspectionTemplate,
  type InspectionItem,
} from "@/lib/inspection-templates";
import { createJob, getJob, jobInput } from "./jobs";
import { audit, type RequestMeta } from "./records";
import { notifyAdvisorInspectionComplete } from "./job-handoffs";

const itemSchema = z.object({
  key: z.string().min(1).max(60),
  label: z.string().trim().min(1).max(120),
  status: z.enum(["good", "watch", "fix", "na", "unchecked"]),
  note: z.string().max(1000).default(""),
  recommendedWork: z.string().max(200).default(""),
  section: z.string().max(100).optional(),
  hint: z.string().max(300).optional(),
  measurements: z.record(z.enum(["lf","rf","lr","rr","spare"]),z.string().max(20)).optional(),
  hoursHundredths: z.number().int().min(0).max(100000).default(100),
  addedToJob: z.boolean().default(false),
});
export const inspectionItems = z.array(itemSchema).max(60);

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
  return {
    saved: !!row,
    complete: !!row?.completedAt,
    items,
    counts: {
      good: count("good"),
      watch: count("watch"),
      fix: count("fix"),
      unchecked: count("unchecked"),
    },
    // "Needs work" items not yet on the estimate.
    pending: items.filter((i) => i.status === "fix" && !i.addedToJob),
  };
}

export async function saveInspection(
  tx: TenantTx,
  meta: RequestMeta,
  input: { jobId: string; items: InspectionItem[]; submit?: boolean },
) {
  if (!(await getJob(tx, input.jobId))) throw notFound("That job");
  const items = inspectionItems.parse(input.items);
  const allChecked=items.every((i) => i.status !== "unchecked");
  const done=input.submit!==false && allChecked;
  if(input.submit===true && !allChecked)
    throw new AppError("VALIDATION","Complete every inspection point before submitting.");
  if(items.some(i=>(i.status==="watch" || i.status==="fix")&&!i.note.trim() ||
    i.status==="fix" && !i.recommendedWork?.trim())){
    throw new AppError("VALIDATION","Service Soon requires findings; Service Now requires findings and recommended work.");
  }
  const [previous]=await tx.select({completedAt:inspection.completedAt})
    .from(inspection).where(and(eq(inspection.businessId,tx.businessId),
      eq(inspection.jobId,input.jobId))).limit(1);
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
  // Handoff only on the first completion. Draft autosaves do not ping.
  if(done && !previous?.completedAt){
    await notifyAdvisorInspectionComplete(tx,input.jobId);
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
  const current = await getInspection(tx, jobId);
  if (!current.pending.length)
    throw new AppError(
      "INVALID_TRANSITION",
      "Mark items “Needs work” first, then add them to the estimate.",
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
    description: (i.recommendedWork || (i.note ? `${i.label}: ${i.note}` : i.label)).slice(0, 200),
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
  await saveInspection(tx, meta, {
    jobId,
    items: current.items.map((i) =>
      keys.has(i.key) ? { ...i, addedToJob: true } : i,
    ),
  });
  return { added: added.length };
}
