import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { withTenant } from "@/db/tenant";
import { getCustomerWithVehicles } from "@/domain/customers";
import { createVehicleAction } from "@/server/actions/customers";
import { requireShopSession } from "@/server/views/shop";

export default async function CustomerDetailPage(props: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await props.params;
  const s = await requireShopSession(`/app/customers/${customerId}`);
  const data = await withTenant(s.businessId, s.actor, (tx) => getCustomerWithVehicles(tx, customerId));
  const c = data.customer;

  return (
    <main>
      <p><Link href="/app/customers">← Customers</Link></p>
      <h1>{c.displayName}</h1>
      <div className="card">
        <p><strong>Phone:</strong> {c.phoneE164 ?? "—"}</p>
        <p><strong>Email:</strong> {c.email ?? "—"}</p>
        {c.notes && <><strong>Notes</strong><p>{c.notes}</p></>}
      </div>

      <h2>Vehicles</h2>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Vehicle</th><th>VIN</th><th>Plate</th><th>Mileage</th></tr></thead>
          <tbody>
            {data.vehicles.map((v) => (
              <tr key={v.id}>
                <td>{[v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || "Vehicle"}</td>
                <td>{v.vin ?? "—"}</td>
                <td>{v.plate ?? "—"}</td>
                <td>{v.mileage == null ? "—" : v.mileage.toLocaleString()}</td>
              </tr>
            ))}
            {!data.vehicles.length && <tr><td colSpan={4} className="muted">No vehicles yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Add vehicle</h2>
        <ActionForm action={createVehicleAction} hidden={{ customerId }} submitLabel="Add vehicle" successText="Vehicle added.">
          <label htmlFor="year">Year</label>
          <input id="year" name="year" type="number" min={1886} max={2200} inputMode="numeric" />
          <label htmlFor="make">Make</label>
          <input id="make" name="make" maxLength={100} />
          <label htmlFor="model">Model</label>
          <input id="model" name="model" maxLength={100} />
          <label htmlFor="trim">Trim</label>
          <input id="trim" name="trim" maxLength={100} />
          <label htmlFor="vin">VIN</label>
          <input id="vin" name="vin" maxLength={17} autoCapitalize="characters" />
          <label htmlFor="plate">Plate</label>
          <input id="plate" name="plate" maxLength={20} autoCapitalize="characters" />
          <label htmlFor="mileage">Mileage</label>
          <input id="mileage" name="mileage" type="number" min={0} max={3000000} inputMode="numeric" />
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" rows={4} maxLength={5000} />
        </ActionForm>
      </div>
    </main>
  );
}
