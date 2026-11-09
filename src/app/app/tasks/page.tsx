import Link from "next/link";
import type { ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { formatMoney } from "@/components/estimate-document";
import { HydratedMain } from "@/components/hydrated-main";
import { TasksNavigation } from "@/components/tasks-navigation";
import { withTenant } from "@/db/tenant";
import { listCustomers } from "@/domain/customers";
import { listTasks, type TaskRow } from "@/domain/tasks";
import type { TaskAction } from "@/lib/task-action";
import { addLocalDays } from "@/lib/timezone";
import { updateRecoveryAction } from "@/server/actions/money-finder";
import { addTaskAction, updateTaskAction } from "@/server/actions/tasks";
import { requireShopSession } from "@/server/views/shop";

const nice = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });

export default async function TasksPage(props: {
  searchParams: Promise<{ view?: string; add?: string; customerId?: string }>;
}) {
  const p = await props.searchParams;
  const s = await requireShopSession("/app/tasks");
  const readOnly = s.actor.type === "support";
  const view = p.view === "later" ? "later" : "due";
  const [data, customers] = await withTenant(s.businessId, s.actor, (tx) =>
    Promise.all([listTasks(tx), p.add ? listCustomers(tx) : []]),
  );
  const rows = view === "due" ? data.due : data.later;
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <header className="customer-list-heading">
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
      {p.add && !readOnly && (
        <section className="card add-panel" aria-label="Add a task">
          <h2>Add a task</h2>
          <ActionForm
            action={addTaskAction}
            submitLabel="Save task"
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

function TaskActionLink({
  action,
  children,
  button = false,
}: {
  action: TaskAction;
  children: ReactNode;
  button?: boolean;
}) {
  const props = {
    href: action.href,
    className: button ? "btn secondary" : undefined,
  };
  return action.kind === "work" ? (
    <Link {...props}>{children}</Link>
  ) : (
    <a {...props}>{children}</a>
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
  const related = t.href && t.href !== action?.href ? t.href : null;
  const relatedLabel = related?.startsWith("/app/customers/")
    ? "View customer"
    : related?.startsWith("/app/jobs?")
      ? "View job"
      : "View details";
  const canUpdate = !readOnly && !later && t.source !== "work";
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
              <TaskActionLink action={action}>{t.title}</TaskActionLink>
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
            <TaskActionLink action={action} button>
              {action.label}
            </TaskActionLink>
          )}
          {related && (
            <Link className="btn secondary" href={related}>
              {relatedLabel}
            </Link>
          )}
          {canUpdate && t.source === "manual" && (
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
          {canUpdate && t.source === "rule" && (
            <>
              <ActionForm
                action={updateRecoveryAction}
                hidden={{
                  ...rule,
                  action: "contact",
                  method: contactMethod,
                  ...(action?.kind === "text" ? { note: "Text message" } : {}),
                  deliveryConfirmed: "true",
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
              <ActionForm
                action={updateRecoveryAction}
                hidden={{ ...rule, action: "dismiss", reason: "Not needed" }}
                submitLabel="Not needed"
                variant="secondary"
              />
            </>
          )}
        </div>
      )}
    </li>
  );
}
