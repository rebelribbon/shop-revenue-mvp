import { getBusinessProfile } from "@/domain/business-profile";
import { isAutomotive, workspaceLabels } from "@/lib/business-types";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { withTenant } from "@/db/tenant";
import { listAppointmentChoices, listTodayTomorrow } from "@/domain/appointments";
import { createAppointmentAction, setAppointmentStatusAction } from "@/server/actions/appointments";
import { requireShopSession } from "@/server/views/shop";

const time = (date: Date, zone: string) => date.toLocaleTimeString("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });

function AppointmentList({ rows, timezone }: { rows: Awaited<ReturnType<typeof listTodayTomorrow>>["today"]; timezone: string }) {
  if (!rows.length) return <p className="muted">Nothing scheduled.</p>;
  return (
    <div className="appointment-list">
      {rows.map((a) => (
        <div className="appointment-row" key={a.id}>
          <div className="appointment-time">{time(a.startsAt, timezone)}</div>
          <div className="appointment-body">
            <Link href={`/app/customers/${a.customerId}`}><strong>{a.customerName}</strong></Link>
            <div>{a.reason || "Appointment"}</div>
            {(a.make || a.model || a.plate) && <div className="muted">{[a.year, a.make, a.model].filter(Boolean).join(" ")}{a.plate ? ` • ${a.plate}` : ""}</div>}
            {a.serviceAssetName&&<div>{a.serviceAssetName} · {a.serviceAddress}</div>}
            <span className="pill">{a.status.replace("_", " ")}</span>
            {(a.vehicleId||a.serviceAssetId)&&a.status!=='cancelled'&&<Link href={`/app/jobs?${new URLSearchParams({sourceAppointmentId:a.id,customerId:a.customerId,...(a.vehicleId?{vehicleId:a.vehicleId}:{}),...(a.serviceAssetId?{serviceAssetId:a.serviceAssetId}:{})})}`}>Create job from appointment</Link>}
          </div>
          {a.status === "scheduled" && (
            <div className="appointment-actions">
              <ActionForm action={setAppointmentStatusAction} hidden={{ appointmentId: a.id, status: "completed" }} submitLabel="Complete" variant="secondary" />
              <ActionForm action={setAppointmentStatusAction} hidden={{ appointmentId: a.id, status: "cancelled" }} submitLabel="Cancel" variant="danger" confirm="Cancel this appointment?" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default async function SchedulePage({searchParams}:{searchParams:Promise<{customerId?:string;vehicleId?:string;serviceAssetId?:string;sourceRecoveryItemId?:string;sourceContactActivityId?:string}>}) {
  const params=await searchParams;
  const s = await requireShopSession("/app/schedule");
  const [days, choices, profile] = await withTenant(s.businessId, s.actor, async (tx) =>
    Promise.all([listTodayTomorrow(tx), listAppointmentChoices(tx),getBusinessProfile(tx)]),
  );
  const auto=isAutomotive(profile?.businessType??"automotive");
  const selectedCustomer=choices.customers.some(c=>c.id===params.customerId)?params.customerId:'';
  const selectedVehicle=choices.vehicles.some(v=>v.id===params.vehicleId&&v.customerId===selectedCustomer)?params.vehicleId:'';
  return (
    <main id="main-content" tabIndex={-1}>
      <h1>Schedule</h1>
      <p className="muted">Today and tomorrow in your business timezone.</p>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Today</h2>
        <AppointmentList rows={days.today} timezone={days.timezone} />
      </section>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Tomorrow</h2>
        <AppointmentList rows={days.tomorrow} timezone={days.timezone} />
      </section>

      <section className="card" id="new-appointment">
        <h2 style={{ marginTop: 0 }}>New appointment</h2>
        {choices.customers.length ? (
          <ActionForm variant="primary" action={createAppointmentAction} hidden={params.sourceRecoveryItemId?{sourceRecoveryItemId:params.sourceRecoveryItemId,...(params.sourceContactActivityId?{sourceContactActivityId:params.sourceContactActivityId}:{})}:{}} submitLabel="Schedule appointment" successText="Appointment scheduled.">
            <label htmlFor="customerId">Customer</label>
            <select id="customerId" name="customerId" required defaultValue={selectedCustomer}>
              <option value="" disabled>Select customer</option>
              {choices.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {auto ? <><label htmlFor="vehicleId">Vehicle (optional)</label>
            <select id="vehicleId" name="vehicleId" defaultValue={selectedVehicle}>
              <option value="">No vehicle selected</option>
              {choices.vehicles.map((v) => (
                <option key={v.id} value={v.id}>{[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"}{v.plate ? ` • ${v.plate}` : ""}</option>
              ))}
            </select>
            </> : <><label htmlFor="serviceAssetId">Property / equipment (optional)</label><select name="serviceAssetId" id="serviceAssetId" defaultValue={params.serviceAssetId??""}><option value="">No property / equipment selected</option>{choices.serviceAssets.map(a=><option key={a.id} value={a.id}>{a.displayName}</option>)}</select></>}
            <label htmlFor="startsAt">Date and time</label>
            <input id="startsAt" name="startsAt" type="datetime-local" required />
            <label htmlFor="reason">Reason</label>
            <input id="reason" name="reason" maxLength={200} placeholder={workspaceLabels(profile?.businessType??"automotive").example} />
            <label htmlFor="notes">Notes</label>
            <textarea id="notes" name="notes" rows={3} maxLength={5000} />
          </ActionForm>
        ) : (
          <p>Add a <Link href="/app/customers#new-customer">customer</Link> before scheduling an appointment.</p>
        )}
      </section>
    </main>
  );
}

