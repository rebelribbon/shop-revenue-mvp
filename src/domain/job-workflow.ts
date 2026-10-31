import { and, desc, eq, inArray } from "drizzle-orm";
import { activity, estimateAuthorization, estimateVersion, invoice, invoicePayment, invoiceCheckout, invoiceRefund } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError, notFound } from "@/lib/errors";
import { getJob } from "./jobs";
import { audit, recordActivity, type RequestMeta } from "./records";
import { activeCheckoutStates } from "./payments";
import { sql } from "drizzle-orm";

export type WorkStatus = "not_recorded" | "in_progress" | "completed";
export const stageLabels = { draft: "Estimate needed", awaiting: "Awaiting customer", declined: "Declined", ready: "Ready for work", working: "Work in progress", bill: "Ready to invoice", payment: "Payment due", paid: "Paid & work complete", attention: "Payment review needed" } as const;

export async function loadJobWorkflows(tx: TenantTx, jobIds: string[]) {
  if (!jobIds.length) return new Map<string, JobWorkflow>();
  const versions = await tx.select({ estimate: estimateVersion, authorization: estimateAuthorization }).from(estimateVersion)
    .leftJoin(estimateAuthorization, and(eq(estimateAuthorization.businessId, tx.businessId), eq(estimateAuthorization.versionId, estimateVersion.id)))
    .where(and(eq(estimateVersion.businessId, tx.businessId), inArray(estimateVersion.quoteId, jobIds))).orderBy(desc(estimateVersion.version));
  const invoices = await tx.select().from(invoice).where(and(eq(invoice.businessId, tx.businessId), inArray(invoice.quoteId, jobIds))).orderBy(desc(invoice.createdAt));
  const invoiceIds = invoices.map(i => i.id);
  const payments = invoiceIds.length ? await tx.select().from(invoicePayment).where(and(eq(invoicePayment.businessId, tx.businessId), inArray(invoicePayment.invoiceId, invoiceIds))).orderBy(invoicePayment.createdAt) : [];
  const checkouts = invoiceIds.length ? await tx.select().from(invoiceCheckout).where(and(eq(invoiceCheckout.businessId, tx.businessId), inArray(invoiceCheckout.invoiceId, invoiceIds), inArray(invoiceCheckout.status, activeCheckoutStates))) : [];
  const refunds = invoiceIds.length ? await tx.select().from(invoiceRefund).where(and(eq(invoiceRefund.businessId, tx.businessId), inArray(invoiceRefund.invoiceId, invoiceIds), inArray(invoiceRefund.status, ["creating", "pending"]))) : [];
  const events = await tx.select({id:activity.id,subjectId:activity.subjectId,kind:activity.kind,summary:activity.summary,occurredAt:activity.occurredAt,data:sql<Record<string,unknown>>`case when ${activity.kind}='job.costed' then '{}'::jsonb else ${activity.data} end`}).from(activity).where(and(eq(activity.businessId, tx.businessId), eq(activity.subjectType, "job"), inArray(activity.subjectId, jobIds), inArray(activity.kind, ["job.costed", "job.progress", "job.shared"]))).orderBy(activity.occurredAt, activity.id);
  const result = new Map<string, JobWorkflow>();
  for (const jobId of jobIds) {
    const estimates = versions.filter(v => v.estimate.quoteId === jobId);
    const latest = estimates[0] ?? null;
    const approved = latest?.estimate.snapshot.lines.filter(l => latest.authorization?.approvedLineIds.includes(l.id)) ?? [];
    const declined = latest?.authorization ? latest.estimate.snapshot.lines.filter(l => !latest.authorization!.approvedLineIds.includes(l.id)) : [];
    const progress = events.filter(e => e.subjectId === jobId && e.kind === "job.progress" && (e.data as { versionId?: string }).versionId === latest?.estimate.id).at(-1);
    const recorded = (progress?.data as { status?: string } | undefined)?.status;
    const work: WorkStatus = recorded === "completed" || recorded === "in_progress" ? recorded : "not_recorded";
    const issued = invoices.filter(i => i.quoteId === jobId);
    const currentInvoice = issued.find(i => !i.voidedAt) ?? null;
    const entries = payments.filter(p => p.invoiceId === currentInvoice?.id);
    const paidCents = entries.reduce((sum, p) => sum + p.amountCents, 0);
    const balanceCents = currentInvoice ? currentInvoice.totalCents - paidCents : 0;
    const processing = checkouts.some(c => c.invoiceId === currentInvoice?.id);
    const refundPending = refunds.some(r => r.invoiceId === currentInvoice?.id);
    const approval = !latest ? "Not published" : latest.authorization ? !approved.length ? "All work declined" : declined.length ? "Partially authorized" : "Authorized" : latest.estimate.revokedAt ? "Link revoked" : latest.estimate.expiresAt <= new Date() ? "Link expired" : "Awaiting customer";
    const stage: keyof typeof stageLabels = !latest ? "draft" : !latest.authorization ? "awaiting" : !approved.length ? "declined" : work === "not_recorded" ? "ready" : work === "in_progress" ? "working" : !currentInvoice ? "bill" : refundPending || currentInvoice.disputeOpen || balanceCents < 0 ? "attention" : balanceCents > 0 ? "payment" : "paid";
    const timeline = events.filter(e => e.subjectId === jobId).map((e, index) => ({ id: e.id, at: e.occurredAt, text: e.kind === "job.costed" ? (index === 0 ? "Job written up" : "Job pricing / hours updated") : e.summary + (typeof (e.data as {note?:unknown}).note === "string" && (e.data as {note:string}).note ? `: ${(e.data as {note:string}).note}` : "") }));
    for (const { estimate: e, authorization: a } of estimates) {
      timeline.push({ id: `estimate-${e.id}`, at: e.createdAt, text: `Estimate v${e.version} published — customer link ready` });
      if (a) timeline.push({ id: `decision-${a.id}`, at: a.createdAt, text: `Customer decision on v${e.version}: ${a.approvedLineIds.length} of ${e.snapshot.lines.length} items authorized · ${a.signerName}` });
    }
    for (const i of issued) {
      timeline.push({ id: `invoice-${i.id}`, at: i.createdAt, text: `Invoice #${i.number} issued — payment requested, not collected` });
      if (i.voidedAt) timeline.push({ id: `void-${i.id}`, at: i.voidedAt, text: `Invoice #${i.number} voided` });
      for (const p of payments.filter(p => p.invoiceId === i.id)) timeline.push({ id: p.id, at: p.createdAt, text: `${p.amountCents < 0 ? "Payment adjustment" : p.method === "stripe" ? "Online payment confirmed" : "Payment recorded by shop"}: ${(p.amountCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} · ${p.method.replaceAll("_", " ")}` });
    }
    timeline.sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
    result.set(jobId, { latest, estimates, approved, declined, work, stage, approval, currentInvoice, entries, paidCents, balanceCents, processing, refundPending, timeline, sharedEstimate: events.some(e => e.subjectId === jobId && e.kind === "job.shared" && (e.data as { documentId?: string }).documentId === latest?.estimate.id && (e.data as {linkHash?:string}).linkHash === latest?.estimate.tokenHash), sharedInvoice: events.some(e => e.subjectId === jobId && e.kind === "job.shared" && (e.data as { documentId?: string }).documentId === currentInvoice?.id && (e.data as {linkHash?:string}).linkHash === currentInvoice?.tokenHash) });
  }
  return result;
}

// These are internal shop projections; no costs or work notes are returned by public links.
type Projection = {
  latest: { estimate: typeof estimateVersion.$inferSelect; authorization: typeof estimateAuthorization.$inferSelect | null } | null;
  estimates: { estimate: typeof estimateVersion.$inferSelect; authorization: typeof estimateAuthorization.$inferSelect | null }[];
  approved: typeof estimateVersion.$inferSelect.snapshot.lines;
  declined: typeof estimateVersion.$inferSelect.snapshot.lines;
  work: WorkStatus; stage: keyof typeof stageLabels; approval: string;
  currentInvoice: typeof invoice.$inferSelect | null; entries: (typeof invoicePayment.$inferSelect)[];
  paidCents: number; balanceCents: number; processing: boolean; refundPending: boolean;
  timeline: { id: string; at: Date; text: string }[]; sharedEstimate: boolean; sharedInvoice: boolean;
};
export type JobWorkflow = Projection;

export async function recordJobProgress(tx: TenantTx, meta: RequestMeta, input: { jobId: string; versionId: string; expectedStatus: WorkStatus; status: "in_progress" | "completed"; note: string }) {
  if (tx.actor.type !== "user") throw new AppError("FORBIDDEN", "Only shop members can record work.");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.jobId},0))`);
  const job = await getJob(tx, input.jobId);
  if (!job) throw notFound("That job");
  const flow = (await loadJobWorkflows(tx, [job.id])).get(job.id)!;
  if (flow.latest?.estimate.id !== input.versionId || !flow.latest.authorization || !flow.approved.length) throw new AppError("CONFLICT", "Refresh the job. Work requires the current customer authorization.");
  if (flow.work !== input.expectedStatus) throw new AppError("CONFLICT", "Work status changed. Refresh before continuing.");
  if (input.status === "completed" && flow.work !== "in_progress") throw new AppError("INVALID_TRANSITION", "Start the authorized work before marking it complete.");
  if (input.status === "in_progress" && flow.work === "in_progress") throw new AppError("INVALID_TRANSITION", "Work is already in progress.");
  if (flow.work === "completed" && !input.note.trim()) throw new AppError("VALIDATION", "Explain why the work is being reopened.");
  const summary = `${input.status === "completed" ? "Work completed" : flow.work === "completed" ? "Work reopened" : "Work started"} · estimate v${flow.latest.estimate.version}`;
  await recordActivity(tx, { kind: "job.progress", recordedAtNow: true, subjectType: "job", subjectId: job.id, summary, data: { versionId: input.versionId, status: input.status, approvedLineIds: flow.latest.authorization.approvedLineIds, note: input.note } });
  await recordActivity(tx, { kind: "work.updated", subjectType: flow.latest.estimate.vehicleId ? "vehicle" : "customer", subjectId: flow.latest.estimate.vehicleId ?? flow.latest.estimate.customerId, summary: `${summary}: ${job.title}`.slice(0, 280), data: { jobId: job.id, status: input.status } });
  await audit(tx, meta, { action: "job.progress_recorded", targetType: "job", targetId: job.id, before: { status: flow.work }, after: { status: input.status, versionId: input.versionId, note: input.note } });
  return { id: job.id, message: input.status === "completed" ? "Authorized work marked complete. Payment status is unchanged." : "Work marked in progress. Payment status is unchanged." };
}

export async function recordJobSharing(tx: TenantTx, meta: RequestMeta, input: { jobId: string; documentId: string; kind: "estimate" | "invoice" }) {
  if (tx.actor.type !== "user") throw new AppError("FORBIDDEN", "Only shop members can record sharing.");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.jobId},0))`);
  const job = await getJob(tx, input.jobId);
  if (!job) throw notFound("That job");
  const flow = (await loadJobWorkflows(tx, [job.id])).get(job.id)!;
  const document = input.kind === "estimate" ? flow.latest?.estimate : flow.currentInvoice;
  if (!document || document.id !== input.documentId) throw new AppError("CONFLICT", "Refresh and use the current document.");
  if (input.kind === "estimate" && flow.latest && (flow.latest.estimate.revokedAt || flow.latest.estimate.expiresAt <= new Date())) throw new AppError("CONFLICT", "Renew this customer link before sharing it.");
  await recordActivity(tx, { kind: "job.shared", recordedAtNow: true, subjectType: "job", subjectId: job.id, summary: `${input.kind === "estimate" ? "Estimate" : "Invoice"} link shared — recorded by shop`, data: { documentId: input.documentId, kind: input.kind, linkHash: document.tokenHash } });
  await audit(tx, meta, { action: "job.sharing_recorded", targetType: "job", targetId: job.id, after: input });
  return { id: job.id, message: "Sharing recorded. This is your confirmation, not a delivery receipt." };
}
