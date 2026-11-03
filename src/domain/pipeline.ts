// Where every job stands, grouped the way a shop thinks about it: the strip
// on Home and the columns on the Jobs board come from this one place.
import { and, eq, inArray } from "drizzle-orm";
import { customer } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { jobStatus, type JobStatus } from "@/lib/job-status";
import { calculateJob } from "./job-costing";
import { loadJobWorkflows } from "./job-workflow";
import { jobInput, listJobs } from "./jobs";

export const STAGES = [
  { key: "estimate", statuses: ["draft", "sent"] },
  { key: "approved", statuses: ["won", "scheduled"] },
  { key: "working", statuses: ["in_progress"] },
  { key: "invoice", statuses: ["unbilled"] },
  { key: "unpaid", statuses: ["invoiced"] },
] as const satisfies readonly { key: string; statuses: readonly JobStatus[] }[];
export type StageKey = (typeof STAGES)[number]["key"];

export type BoardCard = {
  id: string;
  title: string;
  customerName: string;
  label: string | null;
  amountCents: number;
  status: JobStatus;
  repeats: boolean;
  // How long it has sat here, in days (estimate sent, invoice sent, …).
  ageDays: number;
  nextVisit: Date | null;
  // Latest estimate version (to create the invoice from).
  versionId: string | null;
};

const DAY = 86400000;

export async function loadPipeline(tx: TenantTx, now = new Date()) {
  const jobs = await listJobs(tx);
  const flows = await loadJobWorkflows(
    tx,
    jobs.map((j) => j.id),
  );
  const ids = [
    ...new Set(
      jobs
        .map((j) => jobInput.safeParse(j.data))
        .flatMap((p) => (p.success ? [p.data.customerId] : [])),
    ),
  ];
  const names = new Map(
    ids.length
      ? (
          await tx
            .select({ id: customer.id, name: customer.displayName })
            .from(customer)
            .where(
              and(
                eq(customer.businessId, tx.businessId),
                inArray(customer.id, ids),
              ),
            )
        ).map((c) => [c.id, c.name])
      : [],
  );
  const columns = Object.fromEntries(
    STAGES.map((s) => [s.key, [] as BoardCard[]]),
  ) as Record<StageKey, BoardCard[]>;
  for (const j of jobs) {
    const flow = flows.get(j.id);
    if (!flow) continue;
    const status = jobStatus(flow, now);
    const stage = STAGES.find((s) =>
      (s.statuses as readonly string[]).includes(status),
    );
    if (!stage) continue;
    const parsed = jobInput.safeParse(j.data);
    const snap = flow.latest?.estimate.snapshot;
    const since =
      status === "invoiced" && flow.currentInvoice
        ? flow.currentInvoice.createdAt
        : (flow.latest?.estimate.createdAt ?? j.createdAt);
    columns[stage.key].push({
      id: j.id,
      title: j.title,
      customerName:
        snap?.customerName ??
        (parsed.success ? names.get(parsed.data.customerId) : undefined) ??
        "Customer",
      label: snap?.serviceLabel || snap?.vehicleLabel || null,
      amountCents:
        status === "invoiced"
          ? flow.balanceCents
          : (snap?.totalCents ??
            (parsed.success
              ? calculateJob(parsed.data.parts, parsed.data.labor).subtotalCents
              : 0)),
      status,
      repeats: flow.repeats,
      ageDays: Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY)),
      nextVisit: flow.nextVisit,
      versionId: flow.latest?.estimate.id ?? null,
    });
  }
  for (const k of Object.keys(columns) as StageKey[])
    columns[k].sort((a, b) => b.ageDays - a.ageDays);
  const totals = Object.fromEntries(
    STAGES.map((s) => [
      s.key,
      {
        count: columns[s.key].length,
        cents: columns[s.key].reduce((t, c) => t + c.amountCents, 0),
      },
    ]),
  ) as Record<StageKey, { count: number; cents: number }>;
  return { columns, totals };
}
