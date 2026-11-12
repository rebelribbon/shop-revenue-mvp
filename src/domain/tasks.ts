// Tasks: everyone the shop needs to reach, in one list. Two sources:
// reminders made by the shop's follow-up rules (recovery_item state), and
// tasks the shop writes itself (app.task).
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { business, customer, task } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import {
  outcomeLabels,
  type CallTaskOutcome,
  type TaskContact,
} from "@/lib/correspondence";
import { AppError, notFound } from "@/lib/errors";
import { readFollowUpRules, type FollowUpRules } from "@/lib/follow-up-rules";
import {
  CONTACT_TASK_KINDS,
  contactKindForTitle,
  contactTaskAction,
  contactTaskLabels,
  type ContactKind,
  type TaskAction,
} from "@/lib/task-action";
import { addLocalDays, localDateKey } from "@/lib/timezone";
import {
  categoryLabels,
  followUpDueOn,
  listFollowUpItems,
  type MoneyCategory,
} from "./money-finder";
import { getJob, jobInput } from "./jobs";
import { audit, recordActivity, type RequestMeta } from "./records";
import { todayAgenda } from "./today";
import { currentMemberRole, canManageTeam, assertManager } from "./membership";
import { listAdvisors } from "./assignments";
import { getCustomerWithVehicles } from "./customers";
import { listMyJobHandoffs, type JobHandoff } from "./job-handoffs";

export type TaskRow = {
  key: string;
  source: "rule" | "manual" | "work";
  category: MoneyCategory | "manual" | "work";
  // The step this task asks for, separate from its related record.
  action?: TaskAction;
  actionUnavailable?: string;
  kindLabel: string;
  subjectId: string;
  customerId: string | null;
  jobId?: string | null;
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

const HANDOFF_TEXT: Record<
  JobHandoff["stage"],
  { title: string; action: string }
> = {
  inspect_vehicle: {
    title: "Pick up vehicle, diagnose and inspect",
    action: "Open assigned RO",
  },
  build_estimate: {
    title: "Inspection complete — build the estimate",
    action: "Build estimate",
  },
  perform_work: {
    title: "Customer approved — do the authorized work",
    action: "Open approved work",
  },
  invoice_customer: {
    title: "Work complete — invoice the customer",
    action: "Invoice and collect",
  },
};

function handoffTask(h: JobHandoff, today: string): TaskRow {
  return {
    key: `handoff:${h.jobId}:${h.stage}`,
    source: "work",
    category: "work",
    kindLabel: "Assigned RO",
    subjectId: h.jobId,
    customerId: null,
    customerName: null,
    title: HANDOFF_TEXT[h.stage].title,
    detail: h.title,
    amountCents: null,
    phone: null,
    email: null,
    href: `/app/jobs?job=${h.jobId}`,
    action: {
      kind: "work",
      label: HANDOFF_TEXT[h.stage].action,
      href: `/app/jobs?job=${h.jobId}`,
    },
    dueOn: today,
    overdueDays: 0,
  };
}
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
  const role = await currentMemberRole(tx);
  const handoffs = await listMyJobHandoffs(tx);
  const management = await canManageTeam(tx);
  // A technician's Tasks screen is private: no customer follow-ups, sales
  // opportunities, office reminders or other employees' records are loaded.
  if (role === "technician") {
    const [shop] = await tx
      .select({ timezone: business.timezone })
      .from(business)
      .where(eq(business.id, tx.businessId))
      .limit(1);
    const timezone = shop?.timezone ?? "America/Chicago";
    const today = localDateKey(now, timezone);
    return {
      today,
      timezone,
      due: handoffs.map((h) => handoffTask(h, today)),
      later: [] as TaskRow[],
    };
  }
  const [f, agenda] = await Promise.all([
    listFollowUpItems(tx, now),
    todayAgenda(tx, now),
  ]);
  const due: TaskRow[] = [];
  const later: TaskRow[] = [];
  for (const i of management ? f.items : []) {
    const dueOn = followUpDueOn(i, f.today, f.timezone, f.rules);
    const href = hrefFor(i.category, i.subjectId, i.customerId);
    const action: TaskAction | undefined =
      i.category === "unpaid_invoice"
        ? { kind: "work", label: "Record payment", href }
        : i.category === "new_lead"
          ? (contactTaskAction("call", i) ?? contactTaskAction("email", i))
          : (contactTaskAction("text", i) ??
            contactTaskAction("email", i) ??
            contactTaskAction("call", i));
    const row: TaskRow = {
      key: `${i.category}:${i.subjectId}`,
      source: "rule",
      category: i.category,
      kindLabel: categoryLabels[i.category],
      subjectId: i.subjectId,
      customerId: i.customerId,
      jobId: i.category === "job_update" ? i.subjectId : undefined,
      customerName: i.customerName,
      title:
        i.category === "new_lead" && action?.kind !== "call"
          ? `Follow up with new lead ${i.customerName}`
          : titleFor(i.category, i.customerName, i.vehicleLabel),
      detail: i.reason,
      amountCents: i.amountCents,
      phone: i.phone,
      email: i.email,
      href,
      action,
      actionUnavailable: action ? undefined : "No contact details on file.",
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
  for (const w of management ? agenda.items : []) {
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
      action: { kind: "work", label: w.action, href: w.href },
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
      customerStatus: customer.status,
      doNotContact: customer.doNotContact,
      textOptedOutAt: customer.textOptedOutAt,
      emailOptedOutAt: customer.emailOptedOutAt,
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
    const kind = contactKindForTitle(t.title);
    const canContact = t.customerStatus === "active" && !t.doNotContact;
    const action =
      kind && canContact
        ? contactTaskAction(kind, {
            phone: t.phone,
            email: t.emailOptedOutAt ? null : t.email,
            textAllowed: !t.textOptedOutAt,
          })
        : undefined;
    const actionUnavailable =
      !kind || action || !t.customerId
        ? undefined
        : !canContact
          ? "Customer contact is unavailable."
          : kind === "text" && t.textOptedOutAt
            ? "Customer has opted out of texts."
            : kind === "email" && t.emailOptedOutAt
              ? "Customer has opted out of email."
              : kind === "email"
                ? "No email address on file."
                : "No phone number on file.";
    const row: TaskRow = {
      key: `manual:${t.id}`,
      source: "manual",
      category: "manual",
      kindLabel: "Your task",
      subjectId: t.id,
      customerId: t.customerId,
      jobId: t.jobId,
      customerName: t.customerName,
      title: t.title,
      detail: t.customerName,
      amountCents: null,
      phone: t.phone,
      email: t.email,
      action,
      actionUnavailable,
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
  // Show only the logged-in advisor's own estimate handoffs, not other
  // staff members' assigned notifications.
  due.unshift(...handoffs.map((h) => handoffTask(h, f.today)));
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
  input: {
    title: string;
    dueOn: string;
    customerId?: string;
    jobId?: string;
    assignedUserId?: string;
  },
) {
  if (input.customerId) await getCustomerWithVehicles(tx, input.customerId);
  let assignedUserId = tx.actor.id;
  if (input.assignedUserId && input.assignedUserId !== tx.actor.id) {
    await assertManager(tx);
    if (
      !(await listAdvisors(tx)).some((a) => a.userId === input.assignedUserId)
    )
      throw new AppError(
        "VALIDATION",
        "Assign advisor tasks only to active advisors.",
      );
    assignedUserId = input.assignedUserId;
  }
  const [row] = await tx
    .insert(task)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      assignedUserId,
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

export async function getJobFollowUp(tx: TenantTx, jobId: string) {
  const job = await getJob(tx, jobId);
  if (!job) return null;
  const identity = jobInput.pick({ customerId: true }).safeParse(job.data);
  if (!identity.success) return null;
  const { customerId } = identity.data;
  const [person] = await tx
    .select({
      name: customer.displayName,
      phone: customer.phoneE164,
      email: customer.email,
      status: customer.status,
      doNotContact: customer.doNotContact,
      textOff: customer.textOptedOutAt,
      emailOff: customer.emailOptedOutAt,
    })
    .from(customer)
    .where(
      and(eq(customer.businessId, tx.businessId), eq(customer.id, customerId)),
    );
  if (!person) return null;
  const methods =
    person.status === "active" && !person.doNotContact
      ? CONTACT_TASK_KINDS.filter((kind) =>
          contactTaskAction(kind, {
            phone: person.phone,
            email: person.emailOff ? null : person.email,
            textAllowed: !person.textOff,
          }),
        )
      : [];
  return {
    jobId: job.id,
    title: job.title,
    customerId,
    customerName: person.name,
    methods,
  };
}

async function shopToday(tx: TenantTx) {
  const [profile] = await tx
    .select({ timezone: business.timezone })
    .from(business)
    .where(eq(business.id, tx.businessId));
  return localDateKey(new Date(), profile.timezone);
}

export async function addJobFollowUp(
  tx: TenantTx,
  meta: RequestMeta,
  input: { jobId: string; method: ContactKind; dueOn: string },
) {
  const context = await getJobFollowUp(tx, input.jobId);
  if (!context) throw notFound("That job");
  if (!context.methods.includes(input.method))
    throw new AppError("VALIDATION", "Choose an available contact method.");
  const title =
    `${contactTaskLabels[input.method]} about ${context.title}`.slice(0, 200);
  const result = await addTask(tx, meta, {
    title,
    customerId: context.customerId,
    jobId: context.jobId,
    dueOn: input.dueOn,
  });
  const later = input.dueOn > (await shopToday(tx));
  return {
    ...result,
    redirectTo: later
      ? "/app/tasks?view=later&followUp=1"
      : "/app/tasks?followUp=1",
  };
}

export async function updateTask(
  tx: TenantTx,
  meta: RequestMeta,
  input: {
    id: string;
    action: "done" | "snooze" | CallTaskOutcome;
    days?: 1 | 7;
    note?: string;
    taskContact?: TaskContact;
  },
) {
  const [row] = await tx
    .select()
    .from(task)
    .where(and(eq(task.businessId, tx.businessId), eq(task.id, input.id)))
    .for("update");
  if (!row) throw notFound("That task");
  if (row.doneAt) throw new AppError("INVALID_TRANSITION", "Already done.");
  const contact = input.taskContact;
  if (
    contact &&
    (row.customerId !== contact.customerId ||
      row.jobId !== (contact.jobId ?? null) ||
      contactKindForTitle(row.title) !== contact.channel)
  )
    throw notFound("That customer contact task");
  const callOutcome =
    input.action === "done" || input.action === "snooze" ? null : input.action;
  if (
    callOutcome &&
    (!row.customerId || contactKindForTitle(row.title) !== "call")
  )
    throw new AppError("VALIDATION", "Choose a customer call task.");
  const completed = input.action === "done" || input.action === "reached";
  let change: { doneAt: Date } | { dueOn: string } = { doneAt: new Date() };
  if (!completed || contact) {
    const today = await shopToday(tx);
    if ((callOutcome || contact) && row.dueOn > today)
      throw new AppError(
        "INVALID_TRANSITION",
        `This ${callOutcome ? "call" : "task"} is already scheduled for later.`,
      );
    if (contact?.followUpOn && contact.followUpOn <= today)
      throw new AppError("VALIDATION", "Choose a date after today.");
    if (!completed)
      change = {
        dueOn:
          contact?.followUpOn ??
          addLocalDays(today, callOutcome ? 1 : (input.days ?? 1)),
      };
  }
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
  if (completed && row.customerId && !callOutcome && !contact) {
    await recordActivity(tx, {
      kind: "task.completed",
      subjectType: "customer",
      subjectId: row.customerId,
      summary: `Task completed · ${row.title}`,
      data: { taskId: row.id, jobId: row.jobId },
    });
  }
  if (callOutcome && row.customerId) {
    const note = input.action === "reached" ? input.note?.trim() : undefined;
    const result =
      outcomeLabels[callOutcome] + (completed ? "" : " · try tomorrow");
    await recordActivity(tx, {
      kind: "task.call_outcome",
      subjectType: "customer",
      subjectId: row.customerId,
      summary: `${result} · ${row.title}${note ? ` — ${note}` : ""}`,
      data: { taskId: row.id, jobId: row.jobId, outcome: input.action, note },
    });
  }
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
