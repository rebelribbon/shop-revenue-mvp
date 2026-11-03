import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { formatMoney } from "@/components/estimate-document";
import { HydratedMain } from "@/components/hydrated-main";
import { MoneyNavigation } from "@/components/money-navigation";
import { withTenant } from "@/db/tenant";
import { registerDay } from "@/domain/register";
import { addLocalDays } from "@/lib/timezone";
import { closeRegisterAction } from "@/server/actions/register";
import { requireOwnerView } from "@/server/views/shop";

const nice = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
  });

export default async function RegisterPage(props: {
  searchParams: Promise<{ day?: string }>;
}) {
  const { day } = await props.searchParams;
  const s = await requireOwnerView("/app/money/register");
  const r = await withTenant(s.businessId, s.actor, (tx) =>
    registerDay(tx, day),
  );
  const prev = addLocalDays(r.day, -1),
    next = addLocalDays(r.day, 1);
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Money</h1>
      <MoneyNavigation current="register" />
      <Link className="btn primary" data-page-primary href="/app/checkout">
        Take a payment
      </Link>
      <div className="month-step" role="group" aria-label="Choose day">
        <Link href={`/app/money/register?day=${prev}`}>‹ Earlier</Link>
        <strong>{r.day === r.today ? "Today" : nice(r.day)}</strong>
        {r.day < r.today && (
          <Link href={`/app/money/register?day=${next}`}>Later ›</Link>
        )}
      </div>
      <section className="card money-sheet" aria-label="Taken this day">
        <dl>
          {r.methods.length === 0 && (
            <div>
              <dt className="muted">No payments yet</dt>
              <dd>{formatMoney(0)}</dd>
            </div>
          )}
          {r.methods.map((m) => (
            <div key={m.method}>
              <dt>
                {m.label} <span className="muted">· {m.n}</span>
              </dt>
              <dd>{formatMoney(m.cents)}</dd>
            </div>
          ))}
          {r.corrections !== 0 && (
            <div>
              <dt>Refunds and corrections</dt>
              <dd>{formatMoney(r.corrections)}</dd>
            </div>
          )}
          <div className="money-sheet-total">
            <dt>Taken</dt>
            <dd>{formatMoney(r.taken)}</dd>
          </div>
        </dl>
      </section>
      <section className="card" aria-label="Close out the day">
        <h2>Close out the day</h2>
        {r.closed ? (
          <>
            <p>
              Closed. Drawer counted{" "}
              <strong>{formatMoney(r.closed.countedCashCents)}</strong>,
              expected{" "}
              <strong>{formatMoney(r.closed.expectedCashCents)}</strong>
              {r.closed.countedCashCents === r.closed.expectedCashCents
                ? " — it matches."
                : ` — ${r.closed.countedCashCents > r.closed.expectedCashCents ? "over" : "short"} by ${formatMoney(Math.abs(r.closed.countedCashCents - r.closed.expectedCashCents))}.`}
            </p>
            {r.closed.note && <p className="muted">{r.closed.note}</p>}
          </>
        ) : (
          <>
            <p className="muted">
              Cash taken: {formatMoney(r.cashCents)}. Count the drawer and enter
              what’s there; we’ll compare it to starting cash plus cash taken.
            </p>
            {s.actor.type !== "support" && (
              <ActionForm
                action={closeRegisterAction}
                hidden={{ day: r.day }}
                submitLabel="Close out day"
                variant="secondary"
              >
                <label htmlFor="reg-start">
                  Starting cash in the drawer ($)
                </label>
                <input
                  id="reg-start"
                  name="starting"
                  inputMode="decimal"
                  defaultValue="0.00"
                  required
                />
                <label htmlFor="reg-count">Cash counted now ($)</label>
                <input
                  id="reg-count"
                  name="counted"
                  inputMode="decimal"
                  required
                />
                <label htmlFor="reg-note">Note (optional)</label>
                <input id="reg-note" name="note" maxLength={1000} />
              </ActionForm>
            )}
          </>
        )}
      </section>
    </HydratedMain>
  );
}
