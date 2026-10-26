import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { VehicleFields } from "@/components/vehicle-fields";
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
          <VehicleFields initial={v} />
        </ActionForm>
        <ActionForm action={archiveVehicleAction} hidden={{ customerId, vehicleId }} submitLabel="Archive vehicle" variant="danger" confirm="Archive this vehicle? Its history stays attached to the customer." />
      </div>
    </main>
  );
}
