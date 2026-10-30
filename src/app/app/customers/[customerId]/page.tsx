import { ServiceAssets } from "@/components/service-assets";
import { listServiceAssets } from "@/domain/service-assets";
import { getBusinessProfile } from "@/domain/business-profile";
import { isAutomotive } from "@/lib/business-types";
import { Notes, NoteRevision } from "@/components/memory";
import { listNotes } from "@/domain/memory";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { VehicleFields } from "@/components/vehicle-fields";
import { withTenant } from "@/db/tenant";
import { getCustomerWithVehicles, listCustomerTimeline } from "@/domain/customers";
import { archiveCustomerAction, createVehicleAction, updateCustomerAction } from "@/server/actions/customers";
import { requireShopSession } from "@/server/views/shop";
import { setDoNotContactAction } from "@/server/actions/money-finder";

export default async function CustomerDetailPage(props: { params: Promise<{ customerId: string }>; searchParams: Promise<{view?:string}> }) {
  const { customerId } = await props.params;
  const s = await requireShopSession(`/app/customers/${customerId}`);
  const [data, timeline, notes, profile, assets] = await withTenant(s.businessId, s.actor, async (tx) =>
    Promise.all([getCustomerWithVehicles(tx, customerId), listCustomerTimeline(tx, customerId), listNotes(tx,customerId), getBusinessProfile(tx), listServiceAssets(tx,customerId)]),
  );
  const c = data.customer;
  const {view:requestedView}=await props.searchParams;
  const view=['assets','history','details'].includes(requestedView??'')?requestedView:'overview';
  const auto=isAutomotive(profile?.businessType??'automotive');
  const base=`/app/customers/${customerId}`;
  const assetCount=data.vehicles.length+assets.length;

  return (
    <main id="main-content" tabIndex={-1}>
      <p><Link href="/app/customers">← Customers</Link></p>
      <h1>{c.displayName}</h1>
      {view==='overview'&&<Link className="btn primary" data-page-primary href={assetCount?`/app/jobs?customerId=${customerId}`:`${base}?view=assets`}>{assetCount?'New job / estimate':auto?'Add vehicle':'Add property / equipment'}</Link>}
      <nav className="section-tabs" aria-label="Customer sections">
        {([['overview','Overview'],['assets',auto?'Vehicles':'Properties & equipment'],['history','History'],['details','Details']] as const).map(([key,label])=><Link key={key} href={`${base}?view=${key}`} aria-current={view===key?'page':undefined}>{label}</Link>)}
      </nav>
      {view==='overview'&&<>
        <section className="card"><h2>Contact</h2><div className="money-actions">{c.phoneE164?<a href={`tel:${c.phoneE164}`}>{c.phoneE164}</a>:<span className="muted">No phone recorded</span>}{c.email?<a href={`mailto:${c.email}`}>{c.email}</a>:<span className="muted">No email recorded</span>}</div><p>{c.doNotContact?'Do not contact — excluded from Money Finder.':'Manual follow-up allowed.'}</p>{c.notes&&<p>{c.notes}</p>}<Link href={`${base}?view=details`}>Edit contact details</Link></section>
        <section className="card"><h2>{auto?'Vehicles':'Properties & equipment'}</h2>{!assetCount&&<p className="muted">Add a vehicle or service address before quoting work.</p>}
          <div className="record-shortcuts">{data.vehicles.map(v=><Link key={v.id} href={`${base}/vehicles/${v.id}`}>{[v.year,v.make,v.model].filter(Boolean).join(' ')||'Vehicle'}</Link>)}{assets.map(a=><Link key={a.id} href={`${base}?view=assets#asset-${a.id}`}>{a.displayName}</Link>)}</div>
        </section>
        <section className="card"><h2>Recent history</h2><Link href={`/app/jobs?q=${encodeURIComponent(c.displayName)}`}>Find this customer’s jobs</Link>{timeline.slice(0,5).map(event=><div className="overview-row" key={event.id}><strong>{event.summary}</strong><span className="muted">{event.occurredAt.toLocaleDateString('en-US',{timeZone:profile?.timezone||'America/Chicago'})}</span></div>)}{!timeline.length&&<p className="muted">No history yet.</p>}<Link href={`${base}?view=history`}>View full history & notes</Link></section>
      </>}
      {view==='details'&&<>
      <div className="card"><h2>Contact preference</h2><p>{c.doNotContact?'Do not contact — excluded from Money Finder.':'Manual follow-up allowed.'}</p>
        {s.actor.type!=='support'&&<ActionForm action={setDoNotContactAction} hidden={{customerId,value:c.doNotContact?'false':'true'}} submitLabel={c.doNotContact?'Allow manual follow-up':'Mark do not contact'} variant="secondary"/>}
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Customer details</h2>
        <ActionForm variant="primary" action={updateCustomerAction} hidden={{ customerId }} submitLabel="Save customer" successText="Customer updated.">
          <label htmlFor="firstName">First name</label><input id="firstName" name="firstName" defaultValue={c.firstName} maxLength={100} />
          <label htmlFor="lastName">Last name</label><input id="lastName" name="lastName" defaultValue={c.lastName} maxLength={100} />
          <label htmlFor="phone">Mobile number</label><input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={c.phoneE164 ?? ""} />
          <label htmlFor="email">Email</label><input id="email" name="email" type="email" defaultValue={c.email ?? ""} />
          <label htmlFor="notes">Notes</label><textarea id="notes" name="notes" rows={4} maxLength={5000} defaultValue={c.notes ?? ""} />
        </ActionForm>
        <ActionForm action={archiveCustomerAction} hidden={{ customerId }} submitLabel="Archive customer" variant="danger" confirm="Archive this customer and their active assets? Their history stays in Shop Revenue." />
      </div>

      </>}
      {view==='history'&&<Notes customerId={customerId} notes={notes}/>}
      {view==='assets'&&<>
      {(!isAutomotive(profile?.businessType??"automotive") || assets.length > 0) && <ServiceAssets customerId={customerId} assets={assets} readOnly={s.actor.type==='support'}/>}
      {(isAutomotive(profile?.businessType??"automotive") || data.vehicles.length > 0) && <>
      <h2>Vehicles</h2>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Vehicle</th><th>VIN</th><th>Plate</th><th>Mileage</th></tr></thead>
          <tbody>
            {data.vehicles.map((v) => (
              <tr key={v.id}>
                <td><Link href={`/app/customers/${customerId}/vehicles/${v.id}`}><strong>{[v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || "Vehicle"}</strong></Link></td>
                <td>{v.vin ?? "—"}</td><td>{v.plate ?? "—"}</td><td>{v.mileage == null ? "—" : v.mileage.toLocaleString()}</td>
              </tr>
            ))}
            {!data.vehicles.length && <tr><td colSpan={4} className="muted">No vehicles yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card" id="new-vehicle">
        <h2 style={{ marginTop: 0 }}>Add vehicle</h2>
        <ActionForm action={createVehicleAction} hidden={{ customerId }} submitLabel="Add vehicle"><VehicleFields /></ActionForm>
      </div>

      </>}
      </>}
      {view==='history'&&<><h2>History</h2>
      <div className="card">
        {timeline.length ? <div className="timeline">{timeline.map((event) => (
          <div className="timeline-item" key={event.id}><strong>{event.summary}</strong>{event.kind.startsWith("note.") && <NoteRevision data={event.data}/>}<div className="muted">{event.occurredAt.toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" })}</div></div>
        ))}</div> : <p className="muted">No history yet.</p>}
      </div>
      </>}
    </main>
  );
}

