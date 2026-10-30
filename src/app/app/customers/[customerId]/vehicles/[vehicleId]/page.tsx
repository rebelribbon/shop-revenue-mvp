import { Notes, Readings } from "@/components/memory";
import { listNotes, listReadings } from "@/domain/memory";
import { recordMileageAction } from "@/server/actions/memory";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { VehicleFields } from "@/components/vehicle-fields";
import { withTenant } from "@/db/tenant";
import { getVehicle } from "@/domain/customers";
import { archiveVehicleAction, updateVehicleAction } from "@/server/actions/customers";
import { requireShopSession } from "@/server/views/shop";
import { Recommendations } from "@/components/recommendations";
import { listRecommendations } from "@/domain/money-finder";
import { business } from "@/db/schema";
import { eq } from "drizzle-orm";
import { localDateKey } from "@/lib/timezone";

export default async function VehicleDetailPage(props: { params: Promise<{ customerId: string; vehicleId: string }> }) {
  const { customerId, vehicleId } = await props.params;
  const s = await requireShopSession(`/app/customers/${customerId}/vehicles/${vehicleId}`);
  const [v,notes,readings] = await withTenant(s.businessId,s.actor,tx=>Promise.all([getVehicle(tx,customerId,vehicleId),listNotes(tx,customerId,vehicleId),listReadings(tx,vehicleId)]));
  const label = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || "Vehicle";
  const extra=await withTenant(s.businessId,s.actor,async tx=>({rows:await listRecommendations(tx,vehicleId),zone:(await tx.select().from(business).where(eq(business.id,s.businessId)))[0].timezone}));
  return (
    <main id="main-content" tabIndex={-1}>
      <p><Link href={`/app/customers/${customerId}`}>← Customer</Link></p>
      <h1>{label}</h1>
      <div className="card">
        <ActionForm variant="primary" action={updateVehicleAction} hidden={{ customerId, vehicleId }} submitLabel="Save vehicle" successText="Vehicle updated.">
          <VehicleFields initial={v} />
        </ActionForm>
        <ActionForm action={archiveVehicleAction} hidden={{ customerId, vehicleId }} submitLabel="Archive vehicle" variant="danger" confirm="Archive this vehicle? Its history stays attached to the customer." />
      </div>
      <div className="card"><h2>Record mileage</h2>
        <ActionForm action={recordMileageAction} hidden={{customerId,vehicleId}} submitLabel="Record mileage">
          <label htmlFor="reading">Odometer (miles)</label><input id="reading" name="value" type="number" min={0} max={3000000} step={1} required />
        </ActionForm>
      </div>
      <Readings readings={readings}/>
      <Recommendations timezone={extra.zone} vehicle={v} rows={extra.rows} today={localDateKey(new Date(),extra.zone)} readOnly={s.actor.type==='support'}/>
      <Notes customerId={customerId} vehicleId={vehicleId} notes={notes}/>
    </main>
  );
}

