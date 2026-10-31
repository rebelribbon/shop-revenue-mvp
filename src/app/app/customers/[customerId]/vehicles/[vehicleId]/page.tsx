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

export default async function VehicleDetailPage(props: { params: Promise<{ customerId: string; vehicleId: string }>; searchParams:Promise<{view?:string}> }) {
  const { customerId, vehicleId } = await props.params;
  const s = await requireShopSession(`/app/customers/${customerId}/vehicles/${vehicleId}`);
  const [v,notes,readings] = await withTenant(s.businessId,s.actor,tx=>Promise.all([getVehicle(tx,customerId,vehicleId),listNotes(tx,customerId,vehicleId),listReadings(tx,vehicleId)]));
  const {view:requestedView}=await props.searchParams;
  const view=requestedView==='edit'||requestedView==='service'?requestedView:'overview';
  const base=`/app/customers/${customerId}/vehicles/${vehicleId}`;
  const label = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || "Vehicle";
  const extra=await withTenant(s.businessId,s.actor,async tx=>({rows:await listRecommendations(tx,vehicleId),zone:(await tx.select().from(business).where(eq(business.id,s.businessId)))[0].timezone}));
  return (
    <main id="main-content" tabIndex={-1}>
      <p><Link href={`/app/customers/${customerId}?view=assets`}>← Customer</Link></p>
      <h1>{label}</h1>
      <nav className="section-tabs" aria-label="Vehicle sections">{([['overview','Overview'],['service','Service & notes'],['edit','Edit vehicle']] as const).map(([key,title])=><Link key={key} href={`${base}?view=${key}`} aria-current={view===key?'page':undefined}>{title}</Link>)}</nav>
      {view==='overview'&&<><Link className="btn primary" data-page-primary href={`/app/jobs?customerId=${customerId}&vehicleId=${vehicleId}`}>New repair / estimate</Link><section className="card"><h2>Vehicle details</h2><dl><dt>VIN</dt><dd>{v.vin||'Not recorded'}</dd><dt>Plate</dt><dd>{v.plate||'Not recorded'}</dd><dt>Mileage</dt><dd>{v.mileage===null?'Not recorded':v.mileage.toLocaleString()}</dd></dl>{v.notes&&<p>{v.notes}</p>}<div className="money-actions"><Link href={`/app/schedule?new=1&customerId=${customerId}&vehicleId=${vehicleId}`}>Schedule a visit</Link><Link href={`${base}?view=edit`}>Update vehicle details</Link></div></section></>}
      {view==='edit'&&<>
      <div className="card">
        <ActionForm variant="primary" action={updateVehicleAction} hidden={{ customerId, vehicleId }} submitLabel="Save vehicle" successText="Vehicle updated.">
          <VehicleFields initial={v} />
        </ActionForm>
        <ActionForm action={archiveVehicleAction} hidden={{ customerId, vehicleId }} submitLabel="Archive vehicle" variant="danger" confirm="Archive this vehicle? Its history stays attached to the customer." />
      </div>
      </>}
      {view==='service'&&<><div className="card"><h2>Record mileage</h2>
        <ActionForm action={recordMileageAction} hidden={{customerId,vehicleId}} submitLabel="Record mileage">
          <label htmlFor="reading">Odometer (miles)</label><input id="reading" name="value" type="number" min={0} max={3000000} step={1} required />
        </ActionForm>
      </div>
      <Readings readings={readings}/>
      <Recommendations timezone={extra.zone} vehicle={v} rows={extra.rows} today={localDateKey(new Date(),extra.zone)} readOnly={s.actor.type==='support'}/>
      <Notes customerId={customerId} vehicleId={vehicleId} notes={notes}/>
      </>}
    </main>
  );
}

