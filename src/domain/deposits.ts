// Deposits: on approved work over an amount the owner sets, ask for a
// percentage up front. Taking a deposit issues the invoice for the approved
// work (as the shop could already do) and records part of it as paid, so
// the ledger stays one invoice per job; the rest is due at pickup.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { business } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import { estimateTotals } from "@/lib/estimate-tax";
import { issueInvoice } from "./invoices";
import { loadJobWorkflows } from "./job-workflow";
import { assertOwner } from "./membership";
import { audit, type RequestMeta } from "./records";

export const depositSettings = z.object({
  on: z.boolean().default(false),
  overCents: z.number().int().min(0).max(100_000_000).default(50000),
  percent: z.number().int().min(5).max(100).default(50),
});
export type DepositSettings = z.infer<typeof depositSettings>;

export async function readDepositSettings(tx: TenantTx) {
  const [row] = await tx
    .select({ v: business.deposits })
    .from(business)
    .where(eq(business.id, tx.businessId));
  const parsed = depositSettings.safeParse(row?.v ?? {});
  return parsed.success ? parsed.data : depositSettings.parse({});
}

export async function saveDepositSettings(
  tx: TenantTx,
  meta: RequestMeta,
  input: DepositSettings,
) {
  await assertOwner(tx);
  const value = depositSettings.parse(input);
  await tx
    .update(business)
    .set({ deposits: value })
    .where(eq(business.id, tx.businessId));
  await audit(tx, meta, {
    action: "deposits.saved",
    targetType: "business",
    targetId: tx.businessId,
    after: value,
  });
  return value;
}

// The deposit to ask for on this much approved work, or null.
export function depositFor(s: DepositSettings, approvedCents: number) {
  if (!s.on || approvedCents <= 0 || approvedCents < s.overCents) return null;
  return Math.round((approvedCents * s.percent) / 100);
}

// What a job needs: approved by the customer, not invoiced yet, over the
// amount. Returns null when no deposit applies.
export async function jobDeposit(tx: TenantTx, jobId: string) {
  const settings = await readDepositSettings(tx);
  if (!settings.on) return null;
  const flow = (await loadJobWorkflows(tx, [jobId])).get(jobId);
  if (!flow?.latest?.authorization || flow.currentInvoice) return null;
  const approved = estimateTotals(
    flow.approved,
    flow.latest.estimate.snapshot.taxBps,
  ).totalCents;
  const cents = depositFor(settings, approved);
  if (cents === null) return null;
  return {
    versionId: flow.latest.estimate.id,
    approvedCents: approved,
    depositCents: cents,
    percent: settings.percent,
  };
}

const money = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    c / 100,
  );

// "Invoice and take deposit": issue the invoice, then checkout takes the
// deposit as a split payment.
export async function startDeposit(
  tx: TenantTx,
  meta: RequestMeta,
  jobId: string,
) {
  const d = await jobDeposit(tx, jobId);
  if (!d)
    throw new AppError(
      "INVALID_TRANSITION",
      "This job doesn’t need a deposit (or it’s already invoiced).",
    );
  const inv = await issueInvoice(tx, meta, {
    versionId: d.versionId,
    dueOn: null,
    terms: `Deposit of ${money(d.depositCents)} (${d.percent}%) due before work starts. The balance is due when the work is done.`,
  });
  return { invoiceId: inv.id, depositCents: d.depositCents };
}
