import { HydratedMain } from "@/components/hydrated-main";
import Link from "next/link";
import { requireOwnerView } from "@/server/views/shop";
import { withTenant } from "@/db/tenant";
import { getOwnerMoney, expenseCategories } from "@/domain/owner-money";
import { formatMoney } from "@/components/estimate-document";
import { MoneyNavigation } from "@/components/money-navigation";
import { ActionForm } from "@/components/action-form";
import {
  addExpenseAction,
  reverseExpenseAction,
} from "@/server/actions/owner-tools";
// "2026-11" ± n months.
function shiftMonth(month: string, n: number) {
  const [y, mo] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
function monthName(month: string, withYear: boolean) {
  return new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: withYear ? "long" : "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

export default async function MoneyPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; new?: string }>;
}) {
  const s = await requireOwnerView("/app/money"),
    p = await searchParams;
  const m = await withTenant(s.businessId, s.actor, (tx) =>
    getOwnerMoney(tx, p.month),
  );
  const readOnly = s.actor.type === "support";
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Money</h1>
      <MoneyNavigation current="overview" />
      {!readOnly && p.new !== "1" && (
        <Link
          href={`/app/money?month=${m.month}&new=1#expense-form`}
          className="btn primary"
          data-page-primary
        >
          Add expense
        </Link>
      )}
      <div className="month-step" role="group" aria-label="Choose month">
        <Link href={`/app/money?month=${shiftMonth(m.month, -1)}`}>
          ‹ {monthName(shiftMonth(m.month, -1), false)}
        </Link>
        <strong>{monthName(m.month, true)}</strong>
        {m.month < m.today.slice(0, 7) && (
          <Link href={`/app/money?month=${shiftMonth(m.month, 1)}`}>
            {monthName(shiftMonth(m.month, 1), false)} ›
          </Link>
        )}
      </div>
      <section className="card money-sheet" aria-label="This month">
        <dl>
          <div>
            <dt>Collected</dt>
            <dd>{formatMoney(m.collectedCents)}</dd>
          </div>
          <div>
            <dt>Expenses</dt>
            <dd>− {formatMoney(m.expenseCents)}</dd>
          </div>
          <div>
            <dt>
              Sales tax <span className="muted">(set aside for the state)</span>
            </dt>
            <dd>− {formatMoney(m.salesTaxCents)}</dd>
          </div>
          <div className="money-sheet-total">
            <dt>Cash left</dt>
            <dd>{formatMoney(m.cashLeftCents)}</dd>
          </div>
        </dl>
        <p className="money-sheet-side">
          <Link href="/app/invoices">
            <span>Customers owe you&nbsp;</span>
            <strong>{formatMoney(m.owedCents)}</strong>
          </Link>
        </p>
      </section>
      <section className="card">
        <h2>Estimated profit</h2>
        <strong className="money-total">
          {m.estimatedProfitCents === null
            ? "Job costs missing"
            : formatMoney(m.estimatedProfitCents)}
        </strong>
        <p className="muted">
          Sales before tax {formatMoney(m.salesCents)} − job costs{" "}
          {formatMoney(m.costCents)} − other expenses. Uses quoted hours;
          excludes income tax and card fees.
        </p>
        {m.unknownCostJobs > 0 && (
          <p className="notice">
            Profit is hidden because {m.unknownCostJobs}{" "}
            {m.unknownCostJobs === 1 ? "invoiced job is" : "invoiced jobs are"}{" "}
            missing a part cost or labor cost. Open the job and fill in what you
            paid.
          </p>
        )}
      </section>
      {p.new === "1" && !readOnly && (
        <section id="expense-form" className="card">
          <h2>Add expense</h2>
          <ActionForm
            action={addExpenseAction}
            submitLabel="Save expense"
            variant="primary"
            successText="Expense saved."
          >
            <label htmlFor="expense-description">What did you pay for?</label>
            <input
              id="expense-description"
              name="description"
              required
              maxLength={200}
            />
            <label htmlFor="expense-amount">Amount paid ($)</label>
            <input
              id="expense-amount"
              name="amount"
              type="number"
              min="0.01"
              max="10000000"
              step="0.01"
              required
            />
            <label htmlFor="expense-date">Date paid</label>
            <input
              id="expense-date"
              name="spentOn"
              type="date"
              defaultValue={
                m.today.startsWith(m.month) ? m.today : m.month + "-01"
              }
              required
            />
            <label htmlFor="expense-category">Category</label>
            <select id="expense-category" name="category" defaultValue="other">
              {expenseCategories.map((c) => (
                <option key={c} value={c}>
                  {c[0].toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
            <label htmlFor="expense-job-cost">
              Already included in a job’s parts or labor cost?
            </label>
            <select
              id="expense-job-cost"
              name="includedInJobCost"
              defaultValue="false"
            >
              <option value="false">No — another business expense</option>
              <option value="true">Yes — already on a job</option>
            </select>
          </ActionForm>
        </section>
      )}
      <h2>Expenses</h2>
      {!m.expenses.length ? (
        <p className="muted">No expenses recorded for this month.</p>
      ) : (
        <ul className="row-list card" aria-label="Expenses">
          {m.expenses.map((e) => (
            <li key={e.id}>
              <div>
                <span className="row-main">
                  <strong>{e.description}</strong>
                  <span className="muted">
                    {[
                      e.spentOn,
                      e.category,
                      e.corrected
                        ? "corrected"
                        : e.reversesExpenseId
                          ? "correction"
                          : "",
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </span>
                <span className="row-side">
                  <strong>{formatMoney(e.amountCents)}</strong>
                </span>
              </div>
              {e.amountCents > 0 && !e.corrected && !readOnly && (
                <details className="row-fix">
                  <summary>Fix this expense</summary>
                  <p className="muted">
                    The original stays in history. Remove it here, then add the
                    correct expense.
                  </p>
                  <ActionForm
                    action={reverseExpenseAction}
                    hidden={{ id: e.id }}
                    submitLabel="Remove incorrect expense"
                    variant="danger"
                    confirm="Remove this expense from totals? Its history will be kept."
                  >
                    <label htmlFor={`reason-${e.id}`}>Reason</label>
                    <input
                      id={`reason-${e.id}`}
                      name="reason"
                      required
                      maxLength={1000}
                    />
                  </ActionForm>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </HydratedMain>
  );
}
