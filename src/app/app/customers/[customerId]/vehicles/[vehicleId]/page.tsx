import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { withTenant } from "@/db/tenant";
import { getVehicle } from "@/domain/customers";
import { archiveVehicleAction, updateVehicleAction } from "@/server/actions/customers";
import { requireShopSession } from "@/server/views/shop";

export default async function VehicleDetailPage(props: { params: Promise<{ customerId: string; vehicleId: string }> }) {
  const { customerId, vehicleId } = await props.params;
  const s = await requireShopSession(`/app/customers/${customerId}/vehicles/${vehicleId}`);
  const v = await withTenant(s.businessId, s.actor, (tx) => getVehicle(tx, customerId, vehicleId));
  const label = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || "Vehicle";
  return (
    <main>
      <p><Link href={`/app/customers/${customerId}`}>← Customer</Link></p>
      <h1>{label}</h1>
      <div className="card">
        <ActionForm action={updateVehicleAction} hidden={{ customerId, vehicleId }} submitLabel="Save vehicle" successText="Vehicle updated.">
          <label htmlFor="year">Year</label><input id="year" name="year" type="number" min={1886} max={2200} defaultValue={v.year ?? ""} />
          <label htmlFor="make">Make</label><input id="make" name="make" maxLength={100} defaultValue={v.make ?? ""} />
          <label htmlFor="model">Model</label><input id="model" name="model" maxLength={100} defaultValue={v.model ?? ""} />
          <label htmlFor="trim">Trim</label><input id="trim" name="trim" maxLength={100} defaultValue={v.trim ?? ""} />
          <label htmlFor="vin">VIN</label><input id="vin" name="vin" maxLength={17} autoCapitalize="characters" defaultValue={v.vin ?? ""} />
          <label htmlFor="plate">Plate</label><input id="plate" name="plate" maxLength={20} autoCapitalize="characters" defaultValue={v.plate ?? ""} />
          <label htmlFor="mileage">Mileage</label><input id="mileage" name="mileage" type="number" min={0} max={3000000} defaultValue={v.mileage ?? ""} />
          <label htmlFor="notes">Notes</label><textarea id="notes" name="notes" rows={4} maxLength={5000} defaultValue={v.notes ?? ""} />
        </ActionForm>
        <ActionForm action={archiveVehicleAction} hidden={{ customerId, vehicleId }} submitLabel="Archive vehicle" variant="danger"
          confirm="Archive this vehicle? Its history stays attached to the customer." />
      </div>
    </main>
  );
}
