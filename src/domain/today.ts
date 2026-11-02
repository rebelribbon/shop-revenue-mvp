// What needs the owner today, from the same records as every other screen:
// visits, bids waiting, work to bill, unpaid invoices, jobs to schedule.
import type { TenantTx } from "@/db/tenant";
import { jobStatus } from "@/lib/job-status";
import { listTodayTomorrow } from "./appointments";
import { listInvoices } from "./invoices";
import { loadJobWorkflows } from "./job-workflow";
import { jobInput, listJobs } from "./jobs";

export type TodayItem = {
  id: string;
  kind: "bid" | "expired" | "unbilled" | "unpaid" | "schedule" | "plan";
  title: string;
  detail: string;
  href: string;
  action: string;
  amountCents: number | null;
  urgent: boolean;
};

const DAY = 86400000;
const days = (from: Date, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - from.getTime()) / DAY));

export async function todayAgenda(tx: TenantTx, now = new Date()) {
  const [visits, jobs, invoices] = await Promise.all([
    listTodayTomorrow(tx, now),
    listJobs(tx),
    listInvoices(tx),
  ]);
  const flows = await loadJobWorkflows(
    tx,
    jobs.map((j) => j.id),
  );
  const items: TodayItem[] = [];
  for (const j of jobs) {
    const flow = flows.get(j.id);
    if (!flow) continue;
    const input = jobInput.safeParse(j.data);
    const customerId = input.success ? input.data.customerId : "";
    const name = flow.latest?.estimate.snapshot.customerName ?? "Customer";
    const total = flow.latest?.estimate.snapshot.totalCents ?? null;
    const status = jobStatus(flow, now);
    const sentAt = flow.latest?.estimate.createdAt;
    if (status === "sent" && sentAt && days(sentAt, now) >= 2)
      items.push({
        id: `bid-${j.id}`,
        kind: "bid",
        title: `${name} hasn’t answered: ${j.title}`,
        detail: `Sent ${days(sentAt, now)} days ago`,
        href: `/app/jobs?job=${j.id}`,
        action: "Send a reminder",
        amountCents: total,
        urgent: days(sentAt, now) >= 7,
      });
    else if (status === "expired" && sentAt && days(sentAt, now) <= 60)
      items.push({
        id: `exp-${j.id}`,
        kind: "expired",
        title: `Estimate link expired: ${j.title}`,
        detail: name,
        href: `/app/jobs?job=${j.id}#job-estimate`,
        action: "Send a new one",
        amountCents: total,
        urgent: false,
      });
    else if (status === "unbilled")
      items.push({
        id: `bill-${j.id}`,
        kind: "unbilled",
        title: `Finished, not billed: ${j.title}`,
        detail: name,
        href: `/app/invoices?new=1&versionId=${flow.latest?.estimate.id}`,
        action: "Create invoice",
        amountCents: total,
        urgent: true,
      });
    else if (status === "won" && flow.repeats)
      items.push({
        id: `plan-${j.id}`,
        kind: "plan",
        title: `${name} approved a service plan: ${j.title}`,
        detail: "Start it to fill the calendar",
        href: `/app/jobs?job=${j.id}`,
        action: "Start service plan",
        amountCents: total,
        urgent: true,
      });
    else if (status === "won")
      items.push({
        id: `sched-${j.id}`,
        kind: "schedule",
        title: `Won, not scheduled: ${j.title}`,
        detail: name,
        href: `/app/schedule?new=1&customerId=${customerId}`,
        action: "Schedule it",
        amountCents: total,
        urgent: false,
      });
  }
  for (const i of invoices) {
    if (i.voidedAt || i.balanceCents <= 0 || i.disputeOpen) continue;
    const age = days(i.createdAt, now);
    const overdue = i.dueOn
      ? new Date(`${i.dueOn}T23:59:59Z`) < now
      : age >= 14;
    if (!overdue && age < 3) continue;
    items.push({
      id: `inv-${i.id}`,
      kind: "unpaid",
      title: `${overdue ? "Overdue" : "Unpaid"}: invoice #${i.number} · ${i.snapshot.customerName}`,
      detail: `${i.snapshot.title} · sent ${age} days ago`,
      href: `/app/invoices?invoiceId=${i.id}`,
      action: "Send reminder / record payment",
      amountCents: i.balanceCents,
      urgent: overdue,
    });
  }
  const order: TodayItem["kind"][] = [
    "unbilled",
    "plan",
    "unpaid",
    "bid",
    "schedule",
    "expired",
  ];
  items.sort(
    (a, b) =>
      Number(b.urgent) - Number(a.urgent) ||
      order.indexOf(a.kind) - order.indexOf(b.kind),
  );
  return { visits, items };
}
