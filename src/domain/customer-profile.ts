// Everything on a customer's profile page, from the same records the rest of
// the app uses: jobs (with workflow status), plans, money and a linked history.
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  activity,
  estimateVersion,
  invoice,
  invoicePayment,
  paymentReminder,
  reviewRequest,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { loadJobWorkflows, stageLabels } from "./job-workflow";
import { listCustomerTimeline } from "./customers";
import { jobStatus } from "@/lib/job-status";

export async function listCustomerJobs(tx: TenantTx, customerId: string) {
  const rows = await tx
    .selectDistinctOn([activity.subjectId], {
      id: activity.subjectId,
      title: activity.summary,
      data: activity.data,
      updatedAt: activity.occurredAt,
    })
    .from(activity)
    .where(
      and(
        eq(activity.businessId, tx.businessId),
        eq(activity.kind, "job.costed"),
        eq(activity.subjectType, "job"),
        sql`${activity.data}->>'customerId' = ${customerId}`,
      ),
    )
    .orderBy(activity.subjectId, desc(activity.occurredAt), desc(activity.id));
  const [firsts, flows] = await Promise.all([
    rows.length
      ? tx
          .select({
            id: activity.subjectId,
            createdAt: sql<Date>`min(${activity.occurredAt})`,
          })
          .from(activity)
          .where(
            and(
              eq(activity.businessId, tx.businessId),
              eq(activity.kind, "job.costed"),
              inArray(
                activity.subjectId,
                rows.map((r) => r.id),
              ),
            ),
          )
          .groupBy(activity.subjectId)
      : [],
    loadJobWorkflows(
      tx,
      rows.map((r) => r.id),
    ),
  ]);
  return rows
    .map((r) => {
      const flow = flows.get(r.id)!;
      const created = firsts.find((f) => f.id === r.id)?.createdAt;
      return {
        id: r.id,
        title: r.title,
        createdAt: created ? new Date(created) : r.updatedAt,
        updatedAt: r.updatedAt,
        stage: flow.stage,
        stageLabel: stageLabels[flow.stage],
        status: jobStatus(flow),
        repeats: flow.repeats,
        amountCents: flow.plan
          ? flow.plan.perVisitCents
          : flow.currentInvoice
            ? flow.paidCents + flow.balanceCents
            : (flow.latest?.estimate.snapshot.totalCents ?? null),
        balanceCents: flow.currentInvoice ? flow.balanceCents : 0,
        plan: flow.plan,
      };
    })
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export async function customerMoney(tx: TenantTx, customerId: string) {
  const [billed] = await tx
    .select({
      billed: sql<string>`coalesce(sum(${invoice.totalCents}),0)`,
    })
    .from(invoice)
    .where(
      and(
        eq(invoice.businessId, tx.businessId),
        eq(invoice.customerId, customerId),
        isNull(invoice.voidedAt),
      ),
    );
  const [paid] = await tx
    .select({
      paid: sql<string>`coalesce(sum(${invoicePayment.amountCents}),0)`,
      last: sql<Date | null>`max(${invoicePayment.createdAt})`,
    })
    .from(invoicePayment)
    .innerJoin(
      invoice,
      and(
        eq(invoice.businessId, invoicePayment.businessId),
        eq(invoice.id, invoicePayment.invoiceId),
      ),
    )
    .where(
      and(
        eq(invoicePayment.businessId, tx.businessId),
        eq(invoice.customerId, customerId),
      ),
    );
  const open = await tx
    .select({
      total: invoice.totalCents,
      paid: sql<string>`coalesce(sum(${invoicePayment.amountCents}),0)`,
    })
    .from(invoice)
    .leftJoin(
      invoicePayment,
      and(
        eq(invoicePayment.businessId, invoice.businessId),
        eq(invoicePayment.invoiceId, invoice.id),
      ),
    )
    .where(
      and(
        eq(invoice.businessId, tx.businessId),
        eq(invoice.customerId, customerId),
        isNull(invoice.voidedAt),
        isNull(invoice.disputeOpen),
      ),
    )
    .groupBy(invoice.id, invoice.totalCents);
  const owed = open.reduce(
    (sum, i) => sum + Math.max(0, i.total - Number(i.paid)),
    0,
  );
  return {
    billedCents: Number(billed.billed),
    paidCents: Number(paid.paid),
    owedCents: owed,
    lastPaidAt: paid.last ? new Date(paid.last) : null,
  };
}

export type HistoryItem = {
  id: string;
  kind: string;
  summary: string;
  at: Date;
  href: string | null;
  isNote: boolean;
};

// The customer's timeline, with each entry linked to what it is about.
export async function customerHistory(
  tx: TenantTx,
  customerId: string,
): Promise<HistoryItem[]> {
  const [events, reminders, reviews] = await Promise.all([
    listCustomerTimeline(tx, customerId),
    tx
      .select({
        id: paymentReminder.id,
        invoiceId: paymentReminder.invoiceId,
        at: paymentReminder.createdAt,
        status: paymentReminder.status,
      })
      .from(paymentReminder)
      .innerJoin(
        invoice,
        and(
          eq(invoice.businessId, paymentReminder.businessId),
          eq(invoice.id, paymentReminder.invoiceId),
        ),
      )
      .where(
        and(
          eq(paymentReminder.businessId, tx.businessId),
          eq(invoice.customerId, customerId),
        ),
      )
      .orderBy(desc(paymentReminder.createdAt))
      .limit(100),
    tx
      .select({
        id: reviewRequest.id,
        invoiceId: reviewRequest.invoiceId,
        at: reviewRequest.createdAt,
        status: reviewRequest.status,
      })
      .from(reviewRequest)
      .where(
        and(
          eq(reviewRequest.businessId, tx.businessId),
          eq(reviewRequest.customerId, customerId),
        ),
      )
      .orderBy(desc(reviewRequest.createdAt))
      .limit(100),
  ]);
  const versionIds = [
    ...new Set(
      events
        .map((e) => (e.data as { versionId?: string } | null)?.versionId)
        .filter((v): v is string => !!v),
    ),
  ];
  const versions = versionIds.length
    ? await tx
        .select({ id: estimateVersion.id, quoteId: estimateVersion.quoteId })
        .from(estimateVersion)
        .where(
          and(
            eq(estimateVersion.businessId, tx.businessId),
            inArray(estimateVersion.id, versionIds),
          ),
        )
    : [];
  const history = events
    .filter(
      (e) =>
        ![
          "note.updated",
          "note.deleted",
          "customer.contact_preference",
        ].includes(e.kind),
    )
    .map((e) => {
      const d = (e.data ?? {}) as Record<string, string | undefined>;
      const job =
        d.jobId ??
        (d.versionId
          ? versions.find((v) => v.id === d.versionId)?.quoteId
          : undefined);
      const href = d.invoiceId
        ? `/app/invoices?invoiceId=${d.invoiceId}`
        : job
          ? `/app/jobs?job=${job}`
          : e.kind.startsWith("appointment.")
            ? "/app/schedule"
            : null;
      return {
        id: e.id,
        kind: e.kind,
        summary: e.summary,
        at: e.occurredAt,
        href,
        isNote: e.kind === "note.created" && d.noteKind !== "profile",
      };
    });
  for (const [label, rows] of [
    ["Payment reminder", reminders],
    ["Review request", reviews],
  ] as const) {
    for (const row of rows) {
      history.push({
        id: row.id,
        kind: "correspondence.email",
        summary: `${label} email ${row.status === "sent" ? "submitted" : "failed"}`,
        at: row.at,
        href: `/app/invoices?invoiceId=${row.invoiceId}`,
        isNote: false,
      });
    }
  }
  return history.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 100);
}
