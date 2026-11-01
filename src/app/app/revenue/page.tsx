import { HydratedMain } from "@/components/hydrated-main";
import { MoneyNavigation } from "@/components/money-navigation";
import Link from "next/link";
import { withTenant } from "@/db/tenant";
import { listRevenue, recentRecoveryFollowups } from "@/domain/revenue";
import { requireShopSession } from "@/server/views/shop";
import { RevenueSummary, revenueMoney } from "@/components/revenue-summary";
import { ActionForm } from "@/components/action-form";
import {
  updateRecoveryAction,
  startRecoveryWorkAction,
} from "@/server/actions/money-finder";
import { categoryLabels } from "@/domain/money-finder";
import { refreshRevenueAction } from "@/server/actions/revenue";
export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const s = await requireShopSession("/app/revenue"),
    params = await searchParams;
  const month =
    typeof params.month === "string" &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month)
      ? params.month
      : undefined;
  const page = Math.max(
    1,
    Math.min(
      Number.parseInt(
        typeof params.page === "string" ? params.page : "1",
        10,
      ) || 1,
      10000,
    ),
  );
  const [data, followups] = await withTenant(s.businessId, s.actor, (tx) =>
    Promise.all([listRevenue(tx, month, page), recentRecoveryFollowups(tx)]),
  );
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <p>
        <Link href="/app">← Follow-ups</Link>
      </p>
      <h1>Follow-up sales</h1>
      <MoneyNavigation current="sales" />
      <RevenueSummary {...data} />
      <form action="/app/revenue" className="card">
        <label htmlFor="revenue-month">Reporting month</label>
        <input
          id="revenue-month"
          type="month"
          name="month"
          defaultValue={data.month}
          required
        />
        <button className="btn secondary">View month</button>
        <p className="muted">
          {data.timezone} · Each sale is counted once. Confirmed follow-up sales
          and other sales are shown separately.
        </p>
      </form>
      {s.actor.type !== "support" && (
        <ActionForm
          action={refreshRevenueAction}
          submitLabel="Refresh recorded evidence"
          variant="secondary"
        />
      )}
      <section id="follow-ups">
        <h2>Recent manual follow-ups</h2>
        <p className="muted">
          Continue here after an item leaves Follow-ups, including lapsed
          contacts in their 90-day cooldown.
        </p>
        {!followups.length && <p>No manual contacts recorded.</p>}
        {followups.map((f) => (
          <article className="card" key={f.id}>
            <h3>
              <Link href={`/app/customers/${f.customerId}`}>
                {f.customerName}
              </Link>{" "}
              · {categoryLabels[f.category]}
            </h3>
            <p>
              {f.vehicleLabel} · {f.status}
            </p>
            <p>
              Last contact:{" "}
              {new Date(f.lastContactAt).toLocaleString("en-US", {
                timeZone: data.timezone,
              })}{" "}
              · {f.method?.replaceAll("_", " ")}
            </p>
            {s.actor.type !== "support" && f.status !== "dismissed" && (
              <>
                <ActionForm
                  action={updateRecoveryAction}
                  hidden={{
                    category: f.category,
                    subjectId: f.subjectId,
                    action: "responded",
                  }}
                  submitLabel="Record customer response"
                  variant="secondary"
                >
                  <label htmlFor={`follow-up-response-${f.id}`}>
                    Actual customer response
                  </label>
                  <input
                    id={`follow-up-response-${f.id}`}
                    name="note"
                    required
                    maxLength={1000}
                  />
                  <p className="muted">
                    Linked to the latest contact. Only an owner confirmation
                    qualifies for direct recovery.
                  </p>
                </ActionForm>
                <div className="money-actions">
                  <ActionForm
                    action={startRecoveryWorkAction}
                    hidden={{
                      category: f.category,
                      subjectId: f.subjectId,
                      destination: "job",
                    }}
                    submitLabel="Create linked job"
                    variant="secondary"
                  />
                  <ActionForm
                    action={startRecoveryWorkAction}
                    hidden={{
                      category: f.category,
                      subjectId: f.subjectId,
                      destination: "appointment",
                    }}
                    submitLabel="Book visit"
                    variant="secondary"
                  />
                </div>
              </>
            )}
          </article>
        ))}
      </section>
      <h2>Sales linked to follow-ups</h2>
      {!data.rows.length && (
        <section className="card">
          <h3>No recovered revenue recorded yet</h3>
          <p>
            Log a real manual contact from Follow-ups. Confirm delivery when
            known, record the actual customer response, then create linked work.
            Declined-work credit requires recommendation links on the billed
            lines. Credit appears only after payments are recorded.
          </p>
          <p>
            Only owner-confirmed responses qualify for direct recovery. An
            unanswered attempt alone earns no credit.
          </p>
        </section>
      )}
      {data.rows.map(({ attribution: a, number, customerName, title }) => (
        <article className="card" key={a.id}>
          <h3>
            <Link href={`/app/revenue/${a.id}`}>
              Invoice #{number} · {title}
            </Link>
          </h3>
          <p>{customerName}</p>
          <p>
            <strong>
              {a.classification === "direct"
                ? "Confirmed follow-up sale"
                : a.classification === "influenced"
                  ? "Sale after a follow-up"
                  : "Reversed / no current credit"}
              : {revenueMoney(a.amountCents)}
            </strong>
          </p>
          <p className="muted">
            {a.ruleCode} · {a.ruleVersion}
            {a.excluded ? " · Owner excluded" : ""}
          </p>
          <Link href={`/app/revenue/${a.id}`}>Explanation and history</Link>
        </article>
      ))}
      <div className="money-actions">
        {page > 1 && (
          <Link href={`/app/revenue?month=${data.month}&page=${page - 1}`}>
            Previous
          </Link>
        )}
        {page * 50 < data.total && (
          <Link href={`/app/revenue?month=${data.month}&page=${page + 1}`}>
            Next 50
          </Link>
        )}
      </div>
    </HydratedMain>
  );
}
