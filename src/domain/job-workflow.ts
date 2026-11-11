import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import {
  activity,
  appointment,
  estimateAuthorization,
  authorizationSummaryColumns,
  type AuthorizationSummary,
  estimateVersion,
  invoice,
  invoicePayment,
  invoiceCheckout,
  invoiceRefund,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError, notFound } from "@/lib/errors";
import { getJob, jobInput } from "./jobs";
import { audit, recordActivity, type RequestMeta } from "./records";
import {
  notifyAdvisorWorkCompleted,
  notifyTechnicianWorkApproved,
} from "./job-handoffs";
import { activeCheckoutStates } from "./payments";
import { listServicePlans, type PlanSummary } from "./service-plans";
import { sql } from "drizzle-orm";
import { estimateTotals } from "@/lib/estimate-tax";
import { unbilledLines } from "@/lib/supplement";

export type WorkStatus = "not_recorded" | "in_progress" | "completed";
export const stageLabels = {
  draft: "Estimate needed",
  awaiting: "Awaiting customer",
  declined: "Declined",
  ready: "Ready for work",
  working: "Work in progress",
  bill: "Ready to invoice",
  payment: "Payment due",
  paid: "Paid & work complete",
  attention: "Payment review needed",
  plan: "Service plan running",
  plan_paused: "Service plan paused",
  plan_ended: "Service plan ended",
} as const;

export async function loadJobWorkflows(tx: TenantTx, jobIds: string[]) {
  if (!jobIds.length) return new Map<string, JobWorkflow>();
  const versions = await tx
    .select({
      estimate: estimateVersion,
      authorization: authorizationSummaryColumns,
    })
    .from(estimateVersion)
    .leftJoin(
      estimateAuthorization,
      and(
        eq(estimateAuthorization.businessId, tx.businessId),
        eq(estimateAuthorization.versionId, estimateVersion.id),
      ),
    )
    .where(
      and(
        eq(estimateVersion.businessId, tx.businessId),
        inArray(estimateVersion.quoteId, jobIds),
      ),
    )
    .orderBy(desc(estimateVersion.version));
  const invoices = await tx
    .select()
    .from(invoice)
    .where(
      and(
        eq(invoice.businessId, tx.businessId),
        inArray(invoice.quoteId, jobIds),
      ),
    )
    .orderBy(desc(invoice.createdAt));
  const invoiceIds = invoices.map((i) => i.id);
  const payments = invoiceIds.length
    ? await tx
        .select()
        .from(invoicePayment)
        .where(
          and(
            eq(invoicePayment.businessId, tx.businessId),
            inArray(invoicePayment.invoiceId, invoiceIds),
          ),
        )
        .orderBy(invoicePayment.createdAt)
    : [];
  const checkouts = invoiceIds.length
    ? await tx
        .select()
        .from(invoiceCheckout)
        .where(
          and(
            eq(invoiceCheckout.businessId, tx.businessId),
            inArray(invoiceCheckout.invoiceId, invoiceIds),
            inArray(invoiceCheckout.status, activeCheckoutStates),
          ),
        )
    : [];
  const refunds = invoiceIds.length
    ? await tx
        .select()
        .from(invoiceRefund)
        .where(
          and(
            eq(invoiceRefund.businessId, tx.businessId),
            inArray(invoiceRefund.invoiceId, invoiceIds),
            inArray(invoiceRefund.status, ["creating", "pending"]),
          ),
        )
    : [];
  const events = await tx
    .select({
      id: activity.id,
      subjectId: activity.subjectId,
      kind: activity.kind,
      summary: activity.summary,
      occurredAt: activity.occurredAt,
      data: sql<
        Record<string, unknown>
      >`case when ${activity.kind}='job.costed' then '{}'::jsonb else ${activity.data} end`,
    })
    .from(activity)
    .where(
      and(
        eq(activity.businessId, tx.businessId),
        eq(activity.subjectType, "job"),
        inArray(activity.subjectId, jobIds),
        inArray(activity.kind, ["job.costed", "job.progress", "job.shared"]),
      ),
    )
    .orderBy(activity.occurredAt, activity.id);
  // What the customer would see from each saved job version (not costs or
  // actual hours), to tell whether the job changed after the estimate froze.
  const costed = await tx
    .select({
      id: activity.id,
      subjectId: activity.subjectId,
      occurredAt: activity.occurredAt,
      data: activity.data,
    })
    .from(activity)
    .where(
      and(
        eq(activity.businessId, tx.businessId),
        eq(activity.subjectType, "job"),
        inArray(activity.subjectId, jobIds),
        eq(activity.kind, "job.costed"),
      ),
    )
    .orderBy(activity.occurredAt, activity.id);
  const customerFacing = (data: unknown) => {
    const parsed = jobInput.safeParse(data);
    if (!parsed.success) return null;
    const j = parsed.data;
    return JSON.stringify([
      j.title,
      j.repeat ?? null,
      j.parts.map((p) => [
        p.description,
        p.quantity,
        p.unitPriceCents,
        p.taxable ?? null,
      ]),
      j.labor.map((l) => [
        l.description,
        l.estimatedHoursHundredths,
        l.sellRateCents,
        l.taxable ?? null,
      ]),
    ]);
  };
  const plans = await listServicePlans(tx, { jobIds });
  // Upcoming one-off visits, to tell "won" from "scheduled".
  const customerIds = [...new Set(versions.map((v) => v.estimate.customerId))];
  const upcoming = customerIds.length
    ? await tx
        .select({
          customerId: appointment.customerId,
          vehicleId: appointment.vehicleId,
          serviceAssetId: appointment.serviceAssetId,
          startsAt: appointment.startsAt,
        })
        .from(appointment)
        .where(
          and(
            eq(appointment.businessId, tx.businessId),
            inArray(appointment.customerId, customerIds),
            eq(appointment.status, "scheduled"),
            isNull(appointment.servicePlanId),
            gte(appointment.startsAt, new Date()),
          ),
        )
        .orderBy(appointment.startsAt)
    : [];
  const result = new Map<string, JobWorkflow>();
  for (const jobId of jobIds) {
    const plan = plans.find((p) => p.quoteId === jobId) ?? null;
    const estimates = versions.filter((v) => v.estimate.quoteId === jobId);
    const latest = estimates[0] ?? null;
    const approved =
      latest?.estimate.snapshot.lines.filter((l) =>
        latest.authorization?.approvedLineIds.includes(l.id),
      ) ?? [];
    const declined = latest?.authorization
      ? latest.estimate.snapshot.lines.filter(
          (l) => !latest.authorization!.approvedLineIds.includes(l.id),
        )
      : [];
    const jobProgress = events.filter(
      (e) => e.subjectId === jobId && e.kind === "job.progress",
    );
    const progress = jobProgress
      .filter(
        (e) =>
          (e.data as { versionId?: string }).versionId === latest?.estimate.id,
      )
      .at(-1);
    const recorded = (progress?.data as { status?: string } | undefined)
      ?.status;
    // A revised estimate mid-job keeps the job moving: work already started on
    // an earlier version stays in progress. Finished work goes back to "in
    // progress" because the revision may add work that isn't done yet.
    const earlier = (
      jobProgress.at(-1)?.data as { status?: string } | undefined
    )?.status;
    const work: WorkStatus =
      recorded === "completed" || recorded === "in_progress"
        ? recorded
        : earlier === "completed" || earlier === "in_progress"
          ? "in_progress"
          : "not_recorded";
    const saves = costed.filter((c) => c.subjectId === jobId);
    const frozenFrom = latest
      ? saves.filter((c) => c.occurredAt <= latest.estimate.createdAt).at(-1)
      : undefined;
    const current = saves.at(-1);
    const changedSinceEstimate =
      !!latest &&
      !!frozenFrom &&
      !!current &&
      current.id !== frozenFrom.id &&
      customerFacing(current.data) !== customerFacing(frozenFrom.data);
    // Plan invoices are billed per visit/month; the job's own invoice is the
    // one-time bill.
    const issued = invoices.filter(
      (i) => i.quoteId === jobId && !i.servicePlanId,
    );
    // The main invoice plus any add-on invoices for supplement work: the
    // job's balance covers all of them.
    const activeInvoices = issued.filter((i) => !i.voidedAt);
    const currentInvoice =
      activeInvoices.find((i) => !i.supplementOf) ?? activeInvoices[0] ?? null;
    const addOnInvoices = activeInvoices.filter((i) => i !== currentInvoice);
    const activeIds = new Set(activeInvoices.map((i) => i.id));
    const entries = payments.filter((p) => activeIds.has(p.invoiceId));
    const paidCents = entries.reduce((sum, p) => sum + p.amountCents, 0);
    const balanceCents =
      activeInvoices.reduce((sum, i) => sum + i.totalCents, 0) - paidCents;
    const processing = checkouts.some((c) => activeIds.has(c.invoiceId));
    const refundPending = refunds.some((r) => activeIds.has(r.invoiceId));
    // Approved supplement work not on any invoice yet.
    const supplementLines =
      currentInvoice && latest?.authorization
        ? unbilledLines(
            approved,
            activeInvoices.flatMap((i) => i.snapshot.lines),
          )
        : [];
    const supplementDueCents = supplementLines.length
      ? estimateTotals(supplementLines, latest!.estimate.snapshot.taxBps)
          .totalCents
      : 0;
    const approval = !latest
      ? "Not published"
      : latest.authorization
        ? !approved.length
          ? "All work declined"
          : declined.length
            ? "Partially authorized"
            : "Authorized"
        : latest.estimate.revokedAt
          ? "Link revoked"
          : latest.estimate.expiresAt <= new Date()
            ? "Link expired"
            : "Awaiting customer";
    const stage: keyof typeof stageLabels = plan
      ? plan.status === "active"
        ? "plan"
        : plan.status === "paused"
          ? "plan_paused"
          : "plan_ended"
      : !latest
        ? "draft"
        : !latest.authorization
          ? "awaiting"
          : !approved.length
            ? "declined"
            : work === "not_recorded"
              ? "ready"
              : work === "in_progress"
                ? "working"
                : !currentInvoice || supplementDueCents > 0
                  ? "bill"
                  : refundPending ||
                      currentInvoice.disputeOpen ||
                      balanceCents < 0
                    ? "attention"
                    : balanceCents > 0
                      ? "payment"
                      : "paid";
    const timeline = events
      .filter((e) => e.subjectId === jobId)
      .map((e, index) => ({
        id: e.id,
        at: e.occurredAt,
        text:
          e.kind === "job.costed"
            ? index === 0
              ? "Job written up"
              : "Job pricing / hours updated"
            : e.summary +
              (typeof (e.data as { note?: unknown }).note === "string" &&
              (e.data as { note: string }).note
                ? `: ${(e.data as { note: string }).note}`
                : ""),
      }));
    for (const { estimate: e, authorization: a } of estimates) {
      timeline.push({
        id: `estimate-${e.id}`,
        at: e.createdAt,
        text: `Estimate v${e.version} published — customer link ready`,
      });
      if (a)
        timeline.push({
          id: `decision-${a.id}`,
          at: a.createdAt,
          text: `Customer decision on v${e.version}: ${a.approvedLineIds.length} of ${e.snapshot.lines.length} items authorized · ${a.signerName}`,
        });
    }
    for (const i of issued) {
      timeline.push({
        id: `invoice-${i.id}`,
        at: i.createdAt,
        text: `Invoice #${i.number} issued — payment requested, not collected`,
      });
      if (i.voidedAt)
        timeline.push({
          id: `void-${i.id}`,
          at: i.voidedAt,
          text: `Invoice #${i.number} voided`,
        });
      for (const p of payments.filter((p) => p.invoiceId === i.id))
        timeline.push({
          id: p.id,
          at: p.createdAt,
          text: `${p.amountCents < 0 ? "Payment adjustment" : p.method === "stripe" ? "Online payment confirmed" : "Payment recorded by shop"}: ${(p.amountCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} · ${p.method.replaceAll("_", " ")}`,
        });
    }
    timeline.sort(
      (a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id),
    );
    const estimateSharedAt =
      events.find(
        (e) =>
          e.subjectId === jobId &&
          e.kind === "job.shared" &&
          e.data.documentId === latest?.estimate.id &&
          e.data.linkHash === latest?.estimate.tokenHash,
      )?.occurredAt ?? null;
    result.set(jobId, {
      latest,
      estimates,
      approved,
      declined,
      work,
      stage,
      approval,
      currentInvoice,
      addOnInvoices,
      supplementLines,
      supplementDueCents,
      entries,
      paidCents,
      balanceCents,
      processing,
      refundPending,
      timeline,
      changedSinceEstimate,
      nextVisit:
        upcoming.find(
          (u) =>
            latest &&
            u.customerId === latest.estimate.customerId &&
            (u.vehicleId ?? null) === (latest.estimate.vehicleId ?? null) &&
            (u.serviceAssetId ?? null) ===
              (latest.estimate.serviceAssetId ?? null),
        )?.startsAt ?? null,
      plan,
      repeats: Boolean(latest?.estimate.snapshot.repeat),
      sharedEstimate: estimateSharedAt !== null,
      estimateSharedAt,
      sharedInvoice: events.some(
        (e) =>
          e.subjectId === jobId &&
          e.kind === "job.shared" &&
          (e.data as { documentId?: string }).documentId ===
            currentInvoice?.id &&
          (e.data as { linkHash?: string }).linkHash ===
            currentInvoice?.tokenHash,
      ),
    });
  }
  return result;
}

// These are internal shop projections; no costs or work notes are returned by public links.
type Projection = {
  latest: {
    estimate: typeof estimateVersion.$inferSelect;
    authorization: AuthorizationSummary | null;
  } | null;
  estimates: {
    estimate: typeof estimateVersion.$inferSelect;
    authorization: AuthorizationSummary | null;
  }[];
  approved: typeof estimateVersion.$inferSelect.snapshot.lines;
  declined: typeof estimateVersion.$inferSelect.snapshot.lines;
  work: WorkStatus;
  stage: keyof typeof stageLabels;
  approval: string;
  currentInvoice: typeof invoice.$inferSelect | null;
  // Add-on invoices billing supplement work, and approved work not billed.
  addOnInvoices: (typeof invoice.$inferSelect)[];
  supplementLines: (typeof estimateVersion.$inferSelect)["snapshot"]["lines"];
  supplementDueCents: number;
  entries: (typeof invoicePayment.$inferSelect)[];
  paidCents: number;
  balanceCents: number;
  processing: boolean;
  refundPending: boolean;
  timeline: { id: string; at: Date; text: string }[];
  // The job's parts/labor/prices were edited after the latest estimate was
  // published, so the customer hasn't seen (or approved) the changes.
  changedSinceEstimate: boolean;
  // Next booked one-off visit for this customer and vehicle/property.
  nextVisit: Date | null;
  // The latest service plan for this job, and whether the estimate repeats.
  plan: PlanSummary | null;
  repeats: boolean;
  sharedEstimate: boolean;
  estimateSharedAt: Date | null;
  sharedInvoice: boolean;
};
export type JobWorkflow = Projection;

export async function recordJobProgress(
  tx: TenantTx,
  meta: RequestMeta,
  input: {
    jobId: string;
    versionId: string;
    expectedStatus: WorkStatus;
    status: "in_progress" | "completed";
    note: string;
  },
) {
  if (tx.actor.type !== "user")
    throw new AppError("FORBIDDEN", "Only shop members can record work.");
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${input.jobId},0))`,
  );
  const job = await getJob(tx, input.jobId);
  if (!job) throw notFound("That job");
  const flow = (await loadJobWorkflows(tx, [job.id])).get(job.id)!;
  if (
    flow.latest?.estimate.id !== input.versionId ||
    !flow.latest.authorization ||
    !flow.approved.length
  )
    throw new AppError(
      "CONFLICT",
      "Refresh the job. Work requires the current customer authorization.",
    );
  if (flow.work !== input.expectedStatus)
    throw new AppError(
      "CONFLICT",
      "Work status changed. Refresh before continuing.",
    );
  if (input.status === "completed" && flow.work !== "in_progress")
    throw new AppError(
      "INVALID_TRANSITION",
      "Start the authorized work before marking it complete.",
    );
  if (input.status === "in_progress" && flow.work === "in_progress")
    throw new AppError("INVALID_TRANSITION", "Work is already in progress.");
  if (flow.work === "completed" && !input.note.trim())
    throw new AppError("VALIDATION", "Explain why the work is being reopened.");
  const summary = `${input.status === "completed" ? "Work completed" : flow.work === "completed" ? "Work reopened" : "Work started"} · estimate v${flow.latest.estimate.version}`;
  await recordActivity(tx, {
    kind: "job.progress",
    recordedAtNow: true,
    subjectType: "job",
    subjectId: job.id,
    summary,
    data: {
      versionId: input.versionId,
      status: input.status,
      approvedLineIds: flow.latest.authorization.approvedLineIds,
      note: input.note,
    },
  });
  await recordActivity(tx, {
    kind: "work.updated",
    subjectType: flow.latest.estimate.vehicleId ? "vehicle" : "customer",
    subjectId:
      flow.latest.estimate.vehicleId ?? flow.latest.estimate.customerId,
    summary: `${summary}: ${job.title}`.slice(0, 280),
    data: { jobId: job.id, status: input.status },
  });
  await audit(tx, meta, {
    action: "job.progress_recorded",
    targetType: "job",
    targetId: job.id,
    before: { status: flow.work },
    after: {
      status: input.status,
      versionId: input.versionId,
      note: input.note,
    },
  });
  // Relay: finished work goes to the advisor to invoice; reopened work goes
  // back to the technician.
  const handoff =
    input.status === "completed"
      ? // Already invoiced with nothing new to bill: no invoice task.
        (!flow.currentInvoice || flow.supplementDueCents > 0) &&
        (await notifyAdvisorWorkCompleted(tx, job.id))
      : flow.work === "completed"
        ? await notifyTechnicianWorkApproved(tx, job.id)
        : false;
  return {
    id: job.id,
    handoff,
    message:
      input.status === "completed"
        ? handoff
          ? "Authorized work marked complete. Your advisor has been notified to invoice."
          : "Authorized work marked complete. Payment status is unchanged."
        : "Work marked in progress. Payment status is unchanged.",
  };
}

export async function recordJobSharing(
  tx: TenantTx,
  meta: RequestMeta,
  input: { jobId: string; documentId: string; kind: "estimate" | "invoice" },
) {
  if (tx.actor.type !== "user")
    throw new AppError("FORBIDDEN", "Only shop members can record sharing.");
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${input.jobId},0))`,
  );
  const job = await getJob(tx, input.jobId);
  if (!job) throw notFound("That job");
  const flow = (await loadJobWorkflows(tx, [job.id])).get(job.id)!;
  const document =
    input.kind === "estimate" ? flow.latest?.estimate : flow.currentInvoice;
  if (!document || document.id !== input.documentId)
    throw new AppError("CONFLICT", "Refresh and use the current document.");
  if (
    input.kind === "estimate" &&
    flow.latest &&
    (flow.latest.estimate.revokedAt ||
      flow.latest.estimate.expiresAt <= new Date())
  )
    throw new AppError(
      "CONFLICT",
      "Renew this customer link before sharing it.",
    );
  await recordActivity(tx, {
    kind: "job.shared",
    recordedAtNow: true,
    subjectType: "job",
    subjectId: job.id,
    summary: `${input.kind === "estimate" ? "Estimate" : "Invoice"} link shared — recorded by shop`,
    data: {
      documentId: input.documentId,
      kind: input.kind,
      linkHash: document.tokenHash,
    },
  });
  await audit(tx, meta, {
    action: "job.sharing_recorded",
    targetType: "job",
    targetId: job.id,
    after: input,
  });
  return {
    id: job.id,
    message:
      "Sharing recorded. This is your confirmation, not a delivery receipt.",
  };
}
