import { ActionForm } from "./action-form";
import {
  addRecommendationAction,
  setNextServiceAction,
  setRecommendationStatusAction,
} from "@/server/actions/money-finder";
import type { listRecommendations } from "@/domain/money-finder";
type Vehicle = {
  id: string;
  customerId: string;
  nextServiceOn: string | null;
  nextServiceDescription: string | null;
  nextServiceAmountCents: number | null;
};
export function Recommendations({
  vehicle,
  today,
  rows,
  readOnly,
  timezone,
}: {
  vehicle: Vehicle;
  today: string;
  timezone: string;
  rows: Awaited<ReturnType<typeof listRecommendations>>;
  readOnly: boolean;
}) {
  const hidden = { customerId: vehicle.customerId, vehicleId: vehicle.id };
  return (
    <section aria-label="Service recommendations">
      <h2>Service &amp; declined work</h2>
      <div className="card">
        <h3>Next service</h3>
        <p>
          Enter the service date you agreed with the customer. Follow-ups shows
          it from 90 days overdue to 14 days ahead.
        </p>
        {readOnly ? (
          <p>{vehicle.nextServiceOn ?? "No service date entered"}</p>
        ) : (
          <ActionForm
            action={setNextServiceAction}
            hidden={hidden}
            submitLabel="Save next service"
          >
            <label htmlFor="next-service-on">Due date (clear to remove)</label>
            <input
              id="next-service-on"
              name="on"
              type="date"
              defaultValue={vehicle.nextServiceOn ?? ""}
            />
            <label htmlFor="next-service-description">Service</label>
            <input
              id="next-service-description"
              name="description"
              maxLength={200}
              defaultValue={vehicle.nextServiceDescription ?? ""}
            />
            <label htmlFor="next-service-amount">
              Expected price ($, optional)
            </label>
            <input
              id="next-service-amount"
              name="amount"
              inputMode="decimal"
              placeholder="Value not set"
              defaultValue={
                vehicle.nextServiceAmountCents === null
                  ? ""
                  : (vehicle.nextServiceAmountCents / 100).toFixed(2)
              }
            />
          </ActionForm>
        )}
      </div>
      {!readOnly && (
        <details className="card">
          <summary>Record declined / postponed work</summary>
          <p>
            Signed estimate declines are captured automatically. Add only
            additional work the customer actually postponed.
          </p>
          <ActionForm
            action={addRecommendationAction}
            hidden={hidden}
            submitLabel="Save declined work"
          >
            <label htmlFor="recommendation-description">Work recommended</label>
            <input
              id="recommendation-description"
              name="description"
              maxLength={500}
              required
            />
            <label htmlFor="recommendation-amount">
              Quoted price before tax ($, optional)
            </label>
            <input
              id="recommendation-amount"
              name="amount"
              inputMode="decimal"
              placeholder="Value unknown"
            />
            <label htmlFor="recommendation-date">Declined / postponed on</label>
            <input
              id="recommendation-date"
              name="declinedOn"
              type="date"
              max={today}
              defaultValue={today}
              required
            />
          </ActionForm>
        </details>
      )}
      {rows.map((r) => (
        <article className="card" key={r.id}>
          <h3>{r.description}</h3>
          <p>
            {r.amountCents === null
              ? "Value unknown"
              : new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: "USD",
                }).format(r.amountCents / 100)}{" "}
            · <span className="pill">{r.status}</span>
          </p>
          <p className="muted">
            {r.sourceVersionId
              ? "From a signed estimate decline"
              : "Recorded by the shop"}{" "}
            · {r.declinedAt.toLocaleDateString("en-US", { timeZone: timezone })}
          </p>
          {!readOnly && (
            <ActionForm
              action={setRecommendationStatusAction}
              hidden={{ id: r.id }}
              submitLabel="Update recommendation"
              variant="secondary"
            >
              <label htmlFor={`recommendation-status-${r.id}`}>
                Current outcome
              </label>
              <select
                id={`recommendation-status-${r.id}`}
                name="status"
                defaultValue={r.status === "dismissed" ? "open" : r.status}
              >
                <option value="open">Open</option>
                <option value="quoted">Re-quoted</option>
                <option value="won">Work approved / completed</option>
                <option value="lost">Lost / completed elsewhere</option>
              </select>
            </ActionForm>
          )}
        </article>
      ))}
    </section>
  );
}
