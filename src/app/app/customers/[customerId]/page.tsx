import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { withTenant } from "@/db/tenant";
import { getCustomerWithVehicles, listCustomerTimeline } from "@/domain/customers";
import { archiveCustomerAction, createVehicleAction, updateCustomerAction } from "@/server/actions/customers";
import { requireShopSession } from "@/server/views/shop";

export default async function CustomerDetailPage(props: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await props.params;
  const s = await requireShopSession(`/app/customers/${customerId}`);
  const [data, timeline] = await withTenant(s.businessId, s.actor, async (tx) =>
    Promise.all([getCustomerWithVehicles(tx, customerId), listCustomerTimeline(tx, customerId)]),
  );
  const c = data.customer;

  return (
    <main>
      <p><Link href="/app/customers">← Customers</Link></p>
      <h1>{c.displayName}</h1>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Customer details</h2>
        <ActionForm action={updateCustomerAction} hidden={{ customerId }} submitLabel="Save customer" successText="Customer updated.">
          <label htmlFor="firstName">First name</label>
          <input id="firstName" name="firstName" defaultValue={c.firstName} maxLength={100} />
          <label htmlFor="lastName">Last name</label>
          <input id="lastName" name="lastName" defaultValue={c.lastName} maxLength={100} />
          <label htmlFor="phone">Mobile number</label>
          <input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={c.phoneE164 ?? ""} />
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" defaultValue={c.email ?? ""} />
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" rows={4} maxLength={5000} defaultValue={c.notes ?? ""} />
        </ActionForm>
        <ActionForm action={archiveCustomerAction} hidden={{ customerId }} submitLabel="Archive customer" variant="danger"
          confirm="Archive this customer and their active vehicles? Their history stays in Shop Revenue." />
      </div>

      <h2>Vehicles</h2>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Vehicle</th><th>VIN</th><th>Plate</th><th>Mileage</th></tr></thead>
          <tbody>
            {data.vehicles.map((v) => (
              <tr key={v.id}>
                <td><Link href={`/app/customers/${customerId}/vehicles/${v.id}`}><strong>{[v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || "Vehicle"}</strong></Link></td>
                <td>{v.vin ?? "—"}</td>
                <td>{v.plate ?? "—"}</td>
                <td>{v.mileage == null ? "—" : v.mileage.toLocaleString()}</td>
              </tr>
            ))}
            {!data.vehicles.length && <tr><td colSpan={4} className="muted">No vehicles yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card" id="new-vehicle">
        <h2 style={{ marginTop: 0 }}>Add vehicle</h2>
        <ActionForm action={createVehicleAction} hidden={{ customerId }} submitLabel="Add vehicle">
          <label htmlFor="year">Year</label><input id="year" name="year" type="number" min={1886} max={2200} inputMode="numeric" />
          <label htmlFor="make">Make</label><input id="make" name="make" maxLength={100} />
          <label htmlFor="model">Model</label><input id="model" name="model" maxLength={100} />
          <label htmlFor="trim">Trim</label><input id="trim" name="trim" maxLength={100} />
          <label htmlFor="vin">VIN</label><input id="vin" name="vin" maxLength={17} autoCapitalize="characters" />
          <label htmlFor="plate">Plate</label><input id="plate" name="plate" maxLength={20} autoCapitalize="characters" />
          <label htmlFor="mileage">Mileage</label><input id="mileage" name="mileage" type="number" min={0} max={3000000} inputMode="numeric" />
          <label htmlFor="vehicleNotes">Notes</label><textarea id="vehicleNotes" name="notes" rows={4} maxLength={5000} />
        </ActionForm>
      </div>

      <h2>History</h2>
      <div className="card">
        {timeline.length ? (
          <div className="timeline">
            {timeline.map((event) => (
              <div className="timeline-item" key={event.id}>
                <strong>{event.summary}</strong>
                <div className="muted">{event.occurredAt.toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" })}</div>
              </div>
            ))}
          </div>
        ) : <p className="muted">No history yet.</p>}
      </div>
    </main>
  );
}
