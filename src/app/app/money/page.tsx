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
      <form method="get" className="card">
        <label htmlFor="money-month">Month</label>
        <input
          id="money-month"
          type="month"
          name="month"
          defaultValue={m.month}
          required
        />
        <button className="btn secondary">Show month</button>
      </form>
      <div className="overview-metrics">
        {[
          ["Collected this month", m.collectedCents],
          ["Customers owe you", m.owedCents],
          ["Sales tax collected (set aside for the state)", m.salesTaxCents],
          ["Expenses this month", m.expenseCents],
          ["Cash left this month", m.cashLeftCents],
        ].map(([label, value]) => (
          <section key={String(label)} className="card overview-metric">
            <strong>{formatMoney(Number(value))}</strong>
            <span>{label}</span>
          </section>
        ))}
      </div>
      <p className="muted">
        Collected includes sales tax and subtracts refunds and corrections.
        Sales tax collected is not your money; set it aside to pay the state.
        Owed includes every unpaid invoice, not just this month. Cash left is
        collected minus sales tax minus expenses.
      </p>
      <section className="card">
        <h2>Estimated profit</h2>
        <strong className="money-total">
          {m.estimatedProfitCents === null
            ? "Job costs missing"
            : formatMoney(m.estimatedProfitCents)}
        </strong>
        <p>
          Sales before tax {formatMoney(m.salesCents)} − quoted job costs{" "}
          {formatMoney(m.costCents)} − other logged expenses.
        </p>
        <p className="muted">
          An estimate based on this month’s invoices and job costs at quoting.
          Labor uses quoted hours. It excludes income tax, unrecorded costs and
          processor fees. Unpaid sales are included. Expenses marked as already
          on a job are not deducted twice.
        </p>
        {m.unknownCostJobs > 0 && (
          <p className="notice">
            {m.unknownCostJobs} invoice(s) need original job costs before a
            profit estimate is available.
          </p>
        )}
        <Link href="/app/invoices">See unpaid invoices</Link>
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
      <section className="card">
        <h2>Expenses</h2>
        {!m.expenses.length && <p>No expenses recorded for this month.</p>}
        {m.expenses.map((e) => (
          <article className="expense-row" key={e.id}>
            <h3>
              {e.description} · {formatMoney(e.amountCents)}
            </h3>
            <p>
              {e.spentOn} · {e.category}
              {e.corrected
                ? " · Corrected"
                : e.reversesExpenseId
                  ? " · Correction"
                  : ""}
            </p>
            {e.amountCents > 0 && !e.corrected && !readOnly && (
              <details>
                <summary>Correct this expense</summary>
                <p>
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
          </article>
        ))}
      </section>
    </HydratedMain>
  );
}
