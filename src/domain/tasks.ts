// Tasks: everyone the shop needs to reach, in one list. Two sources:
// reminders made by the shop's follow-up rules (recovery_item state), and
// tasks the shop writes itself (app.task).
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { customer, task } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError, notFound } from "@/lib/errors";
import {
  readFollowUpRules,
  repeatAfterDays,
  type FollowUpRules,
} from "@/lib/follow-up-rules";
import { addLocalDays, localDateKey } from "@/lib/timezone";
import {
  categoryLabels,
  listFollowUpItems,
  type MoneyCategory,
} from "./money-finder";
import { audit, type RequestMeta } from "./records";
import { todayAgenda } from "./today";

export type TaskRow = {
  key: string;
  source: "rule" | "manual" | "work";
  category: MoneyCategory | "manual" | "work";
  // Work tasks: the one button that finishes them (e.g. "Create invoice").
  action?: { label: string; href: string };
  kindLabel: string;
  subjectId: string;
  customerId: string | null;
  customerName: string | null;
  title: string;
  detail: string | null;
  amountCents: number | null;
  phone: string | null;
  email: string | null;
  href: string | null;
  // The day it's due (today or earlier = due now).
  dueOn: string;
  overdueDays: number;
};

const dayDiff = (a: string, b: string) =>
  Math.round(
    (Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000,
  );

// How each reminder reads in the list: who and why, in plain words.
function titleFor(category: MoneyCategory, name: string, label: string | null) {
  const on = label ? ` on their ${label}` : "";
  switch (category) {
    case "new_lead":
      return `Call new lead ${name}`;
    case "open_estimate":
      return `Ask ${name} about their estimate`;
    case "unpaid_invoice":
      return `Collect payment from ${name}`;
    case "job_update":
      return `Update ${name}${on}`;
    case "lapsed":
      return `Check in with ${name}`;
    case "declined":
      return `Follow up with ${name} on declined work`;
    case "service_due":
      return `Remind ${name}: service due${label ? ` (${label})` : ""}`;
    case "visit_confirm":
      return `Confirm ${name}’s visit`;
    case "warranty_ending":
      return `Invite ${name} in before their warranty ends${label ? ` (${label})` : ""}`;
  }
}

function hrefFor(
  category: MoneyCategory,
  subjectId: string,
  customerId: string,
) {
  if (category === "unpaid_invoice")
    return `/app/checkout?invoiceId=${subjectId}`;
  if (category === "job_update") return `/app/jobs?job=${subjectId}`;
  if (category === "visit_confirm") return "/app/schedule";
  return `/app/customers/${customerId}`;
}

export async function listTasks(tx: TenantTx, now = new Date()) {
  const [f, agenda] = await Promise.all([
    listFollowUpItems(tx, now),
    todayAgenda(tx, now),
  ]);
  const due: TaskRow[] = [];
  const later: TaskRow[] = [];
  for (const i of f.items) {
    // Done: it comes back when the next reminder is due (unpaid invoices
    // every day by default, until they're paid).
    const lastDay = i.lastContactAt
      ? localDateKey(new Date(i.lastContactAt), f.timezone)
      : null;
    const nextAfterContact = lastDay
      ? addLocalDays(lastDay, repeatAfterDays(i.category, f.rules))
      : null;
    // Rule reminders only appear once they're due, so: due today unless
    // snoozed or recently done.
    const dueOn = [i.snoozedUntil, nextAfterContact, f.today]
      .filter((d): d is string => !!d)
      .reduce((x, y) => (x > y ? x : y));
    const row: TaskRow = {
      key: `${i.category}:${i.subjectId}`,
      source: "rule",
      category: i.category,
      kindLabel: categoryLabels[i.category],
      subjectId: i.subjectId,
      customerId: i.customerId,
      customerName: i.customerName,
      title: titleFor(i.category, i.customerName, i.vehicleLabel),
      detail: i.reason,
      amountCents: i.amountCents,
      phone: i.phone,
      email: i.email,
      href: hrefFor(i.category, i.subjectId, i.customerId),
      dueOn,
      // How long it's been waiting, for sorting oldest first.
      overdueDays: Math.max(
        0,
        dayDiff(f.today, localDateKey(new Date(i.occurredAt), f.timezone)),
      ),
    };
    (row.dueOn <= f.today ? due : later).push(row);
  }
  // Work that's waiting on the shop: it leaves the list once it's done.
  for (const w of agenda.items) {
    if (!["unbilled", "schedule", "plan", "expired"].includes(w.kind)) continue;
    due.push({
      key: `work:${w.id}`,
      source: "work",
      category: "work",
      kindLabel: "Work",
      subjectId: w.id,
      customerId: null,
      customerName: w.detail,
      title: w.title,
      detail: w.kind === "plan" ? w.detail : null,
      amountCents: w.amountCents,
      phone: null,
      email: null,
      href: w.href,
      action: { label: w.action, href: w.href },
      dueOn: f.today,
      overdueDays: w.urgent ? 1 : 0,
    });
  }
  const mine = await tx
    .select({
      id: task.id,
      title: task.title,
      dueOn: task.dueOn,
      customerId: task.customerId,
      jobId: task.jobId,
      customerName: customer.displayName,
      phone: customer.phoneE164,
      email: customer.email,
    })
    .from(task)
    .leftJoin(
      customer,
      and(
        eq(customer.businessId, task.businessId),
        eq(customer.id, task.customerId),
      ),
    )
    .where(and(eq(task.businessId, tx.businessId), isNull(task.doneAt)))
    .orderBy(asc(task.dueOn))
    .limit(500);
  for (const t of mine) {
    const row: TaskRow = {
      key: `manual:${t.id}`,
      source: "manual",
      category: "manual",
      kindLabel: "Your task",
      subjectId: t.id,
      customerId: t.customerId,
      customerName: t.customerName,
      title: t.title,
      detail: t.customerName,
      amountCents: null,
      phone: t.phone,
      email: t.email,
      href: t.jobId
        ? `/app/jobs?job=${t.jobId}`
        : t.customerId
          ? `/app/customers/${t.customerId}`
          : null,
      dueOn: t.dueOn,
      overdueDays: Math.max(0, dayDiff(f.today, t.dueOn)),
    };
    (row.dueOn <= f.today ? due : later).push(row);
  }
  // Oldest first, money first within a day.
  due.sort(
    (a, b) =>
      b.overdueDays - a.overdueDays ||
      (b.amountCents ?? 0) - (a.amountCents ?? 0),
  );
  later.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  return { today: f.today, timezone: f.timezone, due, later };
}

export async function addTask(
  tx: TenantTx,
  meta: RequestMeta,
  input: { title: string; dueOn: string; customerId?: string; jobId?: string },
) {
  const [row] = await tx
    .insert(task)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      title: input.title.trim(),
      dueOn: input.dueOn,
      customerId: input.customerId || null,
      jobId: input.jobId || null,
    })
    .returning({ id: task.id });
  await audit(tx, meta, {
    action: "task.created",
    targetType: "task",
    targetId: row.id,
    after: { title: input.title, dueOn: input.dueOn },
  });
  return { id: row.id };
}

export async function updateTask(
  tx: TenantTx,
  meta: RequestMeta,
  input: { id: string; action: "done" | "snooze"; days?: 1 | 7 },
) {
  const [row] = await tx
    .select()
    .from(task)
    .where(and(eq(task.businessId, tx.businessId), eq(task.id, input.id)))
    .for("update");
  if (!row) throw notFound("That task");
  if (row.doneAt) throw new AppError("INVALID_TRANSITION", "Already done.");
  const change =
    input.action === "done"
      ? { doneAt: new Date() }
      : {
          dueOn: addLocalDays(
            localDateKey(
              new Date(),
              String(
                (
                  await tx.execute(
                    sql`SELECT timezone FROM app.business WHERE id=${tx.businessId}`,
                  )
                ).rows[0].timezone,
              ),
            ),
            input.days ?? 1,
          ),
        };
  await tx
    .update(task)
    .set(change)
    .where(and(eq(task.businessId, tx.businessId), eq(task.id, input.id)));
  await audit(tx, meta, {
    action: `task.${input.action}`,
    targetType: "task",
    targetId: input.id,
    after: change,
  });
  return { id: input.id };
}

export async function saveFollowUpRules(
  tx: TenantTx,
  meta: RequestMeta,
  rules: FollowUpRules,
) {
  const clean = readFollowUpRules(rules);
  await tx.execute(
    sql`UPDATE app.business SET follow_up_rules=${JSON.stringify(clean)}::jsonb WHERE id=${tx.businessId}`,
  );
  await audit(tx, meta, {
    action: "business.follow_up_rules_updated",
    targetType: "business",
    targetId: tx.businessId,
    after: clean,
  });
  return clean;
}
