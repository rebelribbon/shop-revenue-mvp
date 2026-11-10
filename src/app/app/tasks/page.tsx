import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { formatMoney } from "@/components/estimate-document";
import { HydratedMain } from "@/components/hydrated-main";
import { TasksNavigation } from "@/components/tasks-navigation";
import { withTenant } from "@/db/tenant";
import { listCustomers } from "@/domain/customers";
import { listTasks, type TaskRow } from "@/domain/tasks";
import { formatPhone } from "@/lib/phone-format";
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
  const technician = s.role === "technician";
  const view = p.view === "later" ? "later" : "due";
  const [data, customers] = await withTenant(s.businessId, s.actor, (tx) =>
    Promise.all([listTasks(tx), p.add && !technician ? listCustomers(tx) : []]),
  );
  const rows = view === "due" ? data.due : data.later;
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Tasks</h1>
      <TasksNavigation current={view} />
      {p.add && !readOnly && !technician && (
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
              placeholder="Call about tires, send photos, order part…"
            />
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
          {rows.map((t, n) => (
            <TaskItem
              key={t.key}
              first={n === 0}
              t={t}
              today={data.today}
              later={view === "later"}
              readOnly={readOnly}
              technician={technician}
            />
          ))}
        </ul>
      )}
      <div className="task-footer">
        {!readOnly && !technician && !p.add && (
          <Link
            className={`btn ${rows.length && view === "due" ? "secondary" : "primary"}`}
            {...(rows.length && view === "due"
              ? {}
              : { "data-page-primary": true })}
            href={`/app/tasks?add=1${p.customerId ? `&customerId=${p.customerId}` : ""}`}
          >
            + Add your own task
          </Link>
        )}
        {s.role === "owner" && (
          <Link href="/app/settings/follow-ups">Follow-up rules</Link>
        )}
      </div>
    </HydratedMain>
  );
}

function TaskItem({
  t,
  first,
  today,
  later,
  readOnly,
  technician,
}: {
  first: boolean;
  t: TaskRow;
  today: string;
  later: boolean;
  readOnly: boolean;
  technician: boolean;
}) {
  const when = later
    ? nice(t.dueOn)
    : t.dueOn < today
      ? `Due ${nice(t.dueOn)}`
      : t.overdueDays > 0 && t.source === "rule"
        ? `Waiting ${t.overdueDays} day${t.overdueDays === 1 ? "" : "s"}`
        : "Today";
  const rule = { category: t.category, subjectId: t.subjectId };
  return (
    <li className="task-item">
      <div>
        <span className="row-main">
          <strong>
            {t.href ? <Link href={t.href}>{t.title}</Link> : t.title}
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
      {!later && !readOnly && t.action && (
        <div className="task-actions">
          <Link
            className="btn secondary"
            href={t.action.href}
            {...(first ? { "data-page-primary": true } : {})}
          >
            {t.action.label}
          </Link>
        </div>
      )}
      {!later && !readOnly && !technician && !t.action && (
        <div className="task-actions">
          {t.phone && (
            <>
              <a
                className="btn secondary"
                href={`tel:${t.phone}`}
                {...(first ? { "data-page-primary": true } : {})}
              >
                Call {formatPhone(t.phone)}
              </a>
              <a className="btn secondary" href={`sms:${t.phone}`}>
                Text
              </a>
            </>
          )}
          {!t.phone && t.email && (
            <a className="btn secondary" href={`mailto:${t.email}`}>
              Email
            </a>
          )}
          {t.source === "manual" ? (
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
          ) : (
            <>
              <ActionForm
                action={updateRecoveryAction}
                hidden={{
                  ...rule,
                  action: "contact",
                  method: t.phone ? "phone" : t.email ? "email" : "in_person",
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
