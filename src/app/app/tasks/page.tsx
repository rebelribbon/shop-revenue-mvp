import { ContactLaunchLink } from "@/components/correspondence";
import {
  outcomeLabels,
  type ContactTask,
  type CorrespondenceTarget,
  type SentSummary,
} from "@/lib/correspondence";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { formatMoney } from "@/components/estimate-document";
import { HydratedMain } from "@/components/hydrated-main";
import { TasksNavigation } from "@/components/tasks-navigation";
import { withTenant } from "@/db/tenant";
import { listCustomers } from "@/domain/customers";
import { getBusinessProfile } from "@/domain/business-profile";
import { getJobFollowUp, listTasks, type TaskRow } from "@/domain/tasks";
import { isAutomotive } from "@/lib/business-types";
import { jobReference } from "@/lib/job-reference";
import { contactTaskLabels, type TaskAction } from "@/lib/task-action";
import { addLocalDays } from "@/lib/timezone";
import { updateRecoveryAction } from "@/server/actions/money-finder";
import {
  addJobFollowUpAction,
  addTaskAction,
  updateTaskAction,
} from "@/server/actions/tasks";
import { requireShopSession } from "@/server/views/shop";

const nice = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });

export default async function TasksPage(props: {
  searchParams: Promise<{
    view?: string;
    add?: string;
    customerId?: string;
    jobId?: string;
    followUp?: string;
  }>;
}) {
  const p = await props.searchParams;
  const s = await requireShopSession("/app/tasks");
  const readOnly = s.actor.type === "support" || s.role === "technician";
  const jobId = p.add && !readOnly ? p.jobId : undefined;
  const view = p.view === "later" ? "later" : "due";
  const [data, customers, context, profile] = await withTenant(
    s.businessId,
    s.actor,
    (tx) =>
      Promise.all([
        listTasks(tx),
        p.add && !readOnly && !jobId ? listCustomers(tx) : [],
        jobId ? getJobFollowUp(tx, jobId) : null,
        jobId ? getBusinessProfile(tx) : null,
      ]),
  );
  if (jobId && !context) notFound();
  const rows = view === "due" ? data.due : data.later;
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <header className="task-heading">
        <h1>Tasks</h1>
        {!readOnly && !p.add && (
          <Link
            className="btn primary"
            data-page-primary
            href={`/app/tasks?add=1${p.customerId ? `&customerId=${encodeURIComponent(p.customerId)}` : ""}`}
          >
            + Add task
          </Link>
        )}
      </header>
      <TasksNavigation current={view} />
      {p.followUp === "1" && (
        <p className="notice ok" role="status">
          Follow-up scheduled.
        </p>
      )}
      {context && (
        <section className="card add-panel" aria-label="Add a follow-up">
          <h2>Add a follow-up</h2>
          <p>
            {context.customerName} ·{" "}
            {jobReference(
              context.jobId,
              isAutomotive(profile?.businessType ?? "automotive"),
            )}{" "}
            · {context.title}
          </p>
          {context.methods.length > 0 ? (
            <ActionForm
              action={addJobFollowUpAction}
              hidden={{ jobId: context.jobId }}
              submitLabel="Save follow-up"
              variant="primary"
            >
              <label htmlFor="follow-up-method">How will you follow up?</label>
              <select id="follow-up-method" name="method">
                {context.methods.map((method) => (
                  <option key={method} value={method}>
                    {contactTaskLabels[method]}
                  </option>
                ))}
              </select>
              <label htmlFor="follow-up-date">Due date</label>
              <input
                id="follow-up-date"
                name="dueOn"
                type="date"
                required
                defaultValue={addLocalDays(data.today, 1)}
              />
            </ActionForm>
          ) : (
            <p className="muted">
              No contact method is available for this customer.
            </p>
          )}
          <Link className="panel-close" href={`/app/jobs?job=${context.jobId}`}>
            Back to job
          </Link>
        </section>
      )}
      {p.add && !readOnly && !context && (
        <section className="card add-panel" aria-label="Add a task">
          <h2>Add a task</h2>
          <ActionForm
            action={addTaskAction}
            submitLabel="Save task"
            successText="Task added."
            variant="primary"
          >
            <label htmlFor="task-title">What do you need to do?</label>
            <input
              id="task-title"
              name="title"
              required
              maxLength={200}
              placeholder="Text about estimate, call about tires, order parts…"
              aria-describedby="task-action-hint"
            />
            <p id="task-action-hint" className="muted">
              Start with Text, Call or Email and select a customer to add a
              shortcut.
            </p>
            <label htmlFor="task-due">When</label>
            <input
              id="task-due"
              name="dueOn"
              type="date"
              required
              defaultValue={addLocalDays(data.today, 1)}
            />
            <label htmlFor="task-customer">Customer (optional)</label>
            <select
              id="task-customer"
              name="customerId"
              defaultValue={p.customerId ?? ""}
            >
              <option value="">No customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </select>
          </ActionForm>
          <Link className="panel-close" href="/app/tasks">
            Close
          </Link>
        </section>
      )}
      {rows.length === 0 ? (
        <div className="empty-records">
          <h2>{view === "due" ? "All caught up" : "Nothing coming up"}</h2>
          <p className="muted">
            {view === "due"
              ? "Tasks fill in on their own from your jobs, invoices, visits and follow-up rules."
              : "Snoozed and finished follow-ups come back here before they’re due."}{" "}
          </p>
        </div>
      ) : (
        <ul className="row-list card task-list" aria-label="Tasks">
          {rows.map((t) => (
            <TaskItem
              key={t.key}
              t={t}
              today={data.today}
              later={view === "later"}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}
      {s.role === "owner" && (
        <div className="task-footer">
          <Link href="/app/settings/follow-ups">Follow-up rules</Link>
        </div>
      )}
    </HydratedMain>
  );
}

const followUpSummaries: Partial<Record<TaskRow["category"], string>> = {
  open_estimate: "Followed up about the estimate.",
  job_update: "Shared an update on the job.",
  visit_confirm: "Asked the customer to confirm their appointment.",
  service_due: "Sent a service reminder.",
  declined: "Followed up about previously declined work.",
  warranty_ending: "Sent a reminder about the warranty ending.",
};

function TaskActionLink({
  action,
  children,
  button = false,
  target,
  purpose,
  sentSummary,
  prompt,
  task,
}: {
  action: TaskAction;
  children: ReactNode;
  button?: boolean;
  target?: CorrespondenceTarget;
  purpose: string;
  sentSummary?: SentSummary;
  prompt: boolean;
  task?: ContactTask;
}) {
  const props = {
    href: action.href,
    className: button ? "btn secondary" : undefined,
  };
  return action.kind === "work" ? (
    <Link {...props}>{children}</Link>
  ) : (
    <ContactLaunchLink
      {...props}
      contact={target}
      channel={action.kind}
      purpose={purpose}
      sentSummary={sentSummary}
      prompt={prompt}
      task={task}
    >
      {children}
    </ContactLaunchLink>
  );
}

function TaskItem({
  t,
  today,
  later,
  readOnly,
}: {
  t: TaskRow;
  today: string;
  later: boolean;
  readOnly: boolean;
}) {
  const when = later
    ? nice(t.dueOn)
    : t.dueOn < today
      ? `Due ${nice(t.dueOn)}`
      : t.overdueDays > 0 && t.source === "rule"
        ? `Waiting ${t.overdueDays} day${t.overdueDays === 1 ? "" : "s"}`
        : "Today";
  const rule = { category: t.category, subjectId: t.subjectId };
  const action = readOnly ? undefined : t.action;
  const summary =
    action?.kind === "text" || action?.kind === "email"
      ? followUpSummaries[t.category]
      : undefined;
  const sentSummary = summary ? { text: summary } : undefined;
  const documentKind =
    t.category === "open_estimate"
      ? "estimate"
      : t.category === "warranty_ending"
        ? "invoice"
        : undefined;
  const target: CorrespondenceTarget | undefined = t.customerId
    ? {
        customerId: t.customerId,
        jobId: t.jobId ?? undefined,
        documentId: documentKind ? t.subjectId : undefined,
        documentKind,
      }
    : undefined;
  const related = t.href && t.href !== action?.href ? t.href : null;
  const relatedLabel = related?.startsWith("/app/customers/")
    ? "View customer"
    : related?.startsWith("/app/jobs?")
      ? "View job"
      : "View details";
  const canUpdate = !readOnly && !later && t.source !== "work";
  const canLogCall = canUpdate && action?.kind === "call";
  let contactTask: ContactTask | undefined;
  if (
    canUpdate &&
    target &&
    (action?.kind === "text" || action?.kind === "email")
  ) {
    const earliestFollowUp = addLocalDays(today, 1);
    if (t.source === "manual") {
      contactTask = {
        target: { source: "manual", id: t.subjectId },
        earliestFollowUp,
      };
    } else if (t.category !== "manual" && t.category !== "work") {
      contactTask = {
        target: {
          source: "rule",
          category: t.category,
          subjectId: t.subjectId,
        },
        earliestFollowUp,
      };
    }
  }
  const updateOutcome =
    t.source === "manual" ? updateTaskAction : updateRecoveryAction;
  const reached: Record<string, string> =
    t.source === "manual"
      ? { id: t.subjectId, action: "reached" }
      : {
          ...rule,
          action: "contact",
          method: "phone",
          callOutcome: "reached",
          deliveryConfirmed: "true",
        };
  const retryCall = (
    outcome: "left_message" | "no_answer",
  ): Record<string, string> =>
    t.source === "manual"
      ? { id: t.subjectId, action: outcome }
      : {
          ...rule,
          action: "snooze",
          method: "phone",
          callOutcome: outcome,
          days: "1",
        };
  const contactMethod =
    action?.kind === "text"
      ? "other"
      : action?.kind === "email"
        ? "email"
        : t.phone
          ? "phone"
          : t.email
            ? "email"
            : "in_person";
  return (
    <li className="task-item">
      <div>
        <span className="row-main">
          <strong>
            {action ? (
              <TaskActionLink
                action={action}
                target={target}
                purpose={t.title}
                sentSummary={sentSummary}
                prompt={!canLogCall}
                task={contactTask}
              >
                {t.title}
              </TaskActionLink>
            ) : (
              t.title
            )}
          </strong>
          <span className="muted">
            {[t.source === "rule" ? t.detail : t.customerName, when]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        {t.amountCents !== null && t.amountCents > 0 && (
          <span className="row-side">
            <strong>{formatMoney(t.amountCents)}</strong>
          </span>
        )}
      </div>
      {!readOnly && t.actionUnavailable && (
        <p className="muted task-unavailable">{t.actionUnavailable}</p>
      )}
      {(action || canUpdate || related) && (
        <div className="task-actions">
          {action && (
            <TaskActionLink
              action={action}
              target={target}
              purpose={t.title}
              sentSummary={sentSummary}
              prompt={!canLogCall}
              task={contactTask}
              button
            >
              {action.label}
            </TaskActionLink>
          )}
          {related && (
            <Link className="btn secondary" href={related}>
              {relatedLabel}
            </Link>
          )}
          {canLogCall && (
            <>
              <ActionForm
                action={updateOutcome}
                hidden={reached}
                submitLabel="Reached"
                successText="Call recorded."
              />
              {(["left_message", "no_answer"] as const).map((outcome) => (
                <ActionForm
                  key={outcome}
                  action={updateOutcome}
                  hidden={retryCall(outcome)}
                  submitLabel={`${outcomeLabels[outcome]} · try tomorrow`}
                  successText="Call recorded. Follow up tomorrow."
                />
              ))}
            </>
          )}
          {canUpdate && !canLogCall && t.source === "manual" && (
            <>
              <ActionForm
                action={updateTaskAction}
                hidden={{ id: t.subjectId, action: "done" }}
                submitLabel="Done"
                variant="secondary"
              />
              <ActionForm
                action={updateTaskAction}
                hidden={{ id: t.subjectId, action: "snooze", days: "1" }}
                submitLabel="Tomorrow"
                variant="secondary"
              />
            </>
          )}
          {canUpdate && !canLogCall && t.source === "rule" && (
            <>
              <ActionForm
                action={updateRecoveryAction}
                hidden={{
                  ...rule,
                  action: "contact",
                  method: contactMethod,
                  note: "Task marked done",
                  deliveryConfirmed: "false",
                }}
                submitLabel="Done"
                variant="secondary"
              />
              <ActionForm
                action={updateRecoveryAction}
                hidden={{ ...rule, action: "snooze", days: "1" }}
                submitLabel="Tomorrow"
                variant="secondary"
              />
            </>
          )}
          {canUpdate && t.source === "rule" && (
            <ActionForm
              action={updateRecoveryAction}
              hidden={{ ...rule, action: "dismiss", reason: "Not needed" }}
              submitLabel="Not needed"
              variant="secondary"
            />
          )}
        </div>
      )}
      {canLogCall && (
        <details className="task-outcome-note">
          <summary>Reached with a note</summary>
          <ActionForm
            action={updateOutcome}
            hidden={reached}
            submitLabel="Save call outcome"
            successText="Call recorded."
          >
            <label htmlFor={`call-note-${t.key}`}>Call note</label>
            <textarea
              id={`call-note-${t.key}`}
              name="note"
              maxLength={300}
              rows={2}
            />
          </ActionForm>
        </details>
      )}
    </li>
  );
}
