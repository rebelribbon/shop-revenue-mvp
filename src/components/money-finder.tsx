import Link from "next/link";
import { ActionForm } from "./action-form";
import { categoryLabels, moneyCategories, type MoneyCategory, type MoneyDashboard, type MoneyItem } from "@/domain/money-finder";
import { updateRecoveryAction, startRecoveryWorkAction } from "@/server/actions/money-finder";
const money=(c:number|null)=>c===null?'Value unknown':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
const date=(s:string,zone:string)=>new Date(s).toLocaleDateString('en-US',{timeZone:zone,dateStyle:'medium'});

function Controls({item,readOnly}:{item:MoneyItem;readOnly:boolean}) {
  if(readOnly) return <p className="muted">Support view is read-only.</p>;
  const hidden={category:item.category,subjectId:item.subjectId};
  if(item.status==='dismissed'||item.snoozedUntil) return <ActionForm action={updateRecoveryAction} hidden={{...hidden,action:'restore'}} submitLabel={item.status==='dismissed'?'Restore opportunity':'Unsnooze'} variant="secondary"/>;
  const key=`${item.category}-${item.subjectId}`;
  return <details><summary>Track follow-up</summary>
    <p className="muted">Contact the customer yourself, then record what happened. Shop Revenue sends nothing.</p>
    <ActionForm action={updateRecoveryAction} hidden={{...hidden,action:'contact'}} submitLabel="Log manual contact">
      <label htmlFor={`${key}-method`}>Contact method</label>
      <select id={`${key}-method`} name="method" required defaultValue={item.phone?'phone':item.email?'email':'in_person'}>
        <option value="phone" disabled={!item.phone}>Phone{!item.phone?' (missing)':''}</option>
        <option value="email" disabled={!item.email}>Email{!item.email?' (missing)':''}</option>
        <option value="in_person">In person</option><option value="other">Other</option>
      </select>
      <label className="checkline"><input type="checkbox" name="deliveryConfirmed" value="true"/>I reached the customer or confirmed this message was delivered.</label>
      <p className="muted">Leave this unchecked for an unanswered attempt or uncertain delivery.</p>
      <label htmlFor={`${key}-note`}>Contact notes</label><textarea id={`${key}-note`} name="note" maxLength={1000} rows={2}/>
    </ActionForm>
    <ActionForm action={updateRecoveryAction} hidden={{...hidden,action:'responded'}} submitLabel="Record customer response" variant="secondary">
      <p className="muted">Record an actual response to the latest logged contact. Direct recovery requires owner confirmation before the resulting work or payment.</p>
      <label htmlFor={`${key}-response`}>What did the customer say?</label><input id={`${key}-response`} name="note" maxLength={1000} required/>
    </ActionForm>
    <div className="money-actions">
      {[30,90].map(days=><ActionForm key={days} action={updateRecoveryAction} hidden={{...hidden,action:'snooze',days:String(days)}} submitLabel={`Snooze ${days} days`} variant="secondary"/>)}
    </div>
    <ActionForm action={updateRecoveryAction} hidden={{...hidden,action:'dismiss'}} submitLabel="Dismiss" variant="danger" confirm="Dismiss this opportunity? You can restore it later.">
      <label htmlFor={`${key}-reason`}>Dismissal reason</label>
      <input id={`${key}-reason`} name="reason" maxLength={1000} required placeholder="Moved, sold vehicle, work done elsewhere…"/>
    </ActionForm>
  </details>;
}

export function MoneyFinder({data,category,view,query,page,readOnly}:{data:MoneyDashboard;category?:MoneyCategory;view:'active'|'snoozed'|'dismissed';query:string;page:number;readOnly:boolean}) {
  const url=(cat?:MoneyCategory,p=1,v=view)=>`/app?${new URLSearchParams({...(cat?{category:cat}:{}),view:v,...(query?{q:query}:{}),page:String(p)})}`;
  const counts=Object.fromEntries(data.cards.map(c=>[c.category,c]));
  return <section aria-label="Money Finder">
    <div className="money-hero"><div><p className="eyebrow">Money Finder</p><h2>{money(data.knownCents)} in recorded opportunities</h2>
      <p>Known amounts from declined work, estimates, balances and entered service prices. These are opportunities, not recovered revenue.</p></div>
      <p className="muted">Lapsed-customer estimates stay separate. Unknown prices are never treated as zero.</p>
    </div>
    <div className="money-grid">
      {[...moneyCategories].filter(c=>c!=='service_due'||data.hasServiceDates).sort((a,b)=>(counts[b]?.knownCents??0)-(counts[a]?.knownCents??0)).map(cat=>{
        const card=counts[cat];return <Link className={`card money-category ${category===cat?'selected':''}`} href={url(cat,1,'active')} key={cat}>
          <h3>{categoryLabels[cat]}</h3><strong>{card?.count??0} {card?.count===1?'opportunity':'opportunities'}</strong>
          <p>{cat==='lapsed'?'Est. ':''}{money(card?.knownCents??0)}{cat==='lapsed'?' · separate from known dollars':''}</p>
          {!!card?.unknownCount&&<p className="muted">{card.unknownCount} with value not set</p>}
          {card?.oldestAt&&<small>Oldest: {date(card.oldestAt,data.timezone)}</small>}
        </Link>;
      })}
    </div>
    <div className="money-actions"><Link href={url(undefined)}>All categories</Link>
      {(['active','snoozed','dismissed'] as const).map(v=><Link key={v} href={url(category,1,v)} aria-current={view===v?'page':undefined}>{v[0].toUpperCase()+v.slice(1)}</Link>)}
    </div>
    <form className="money-search" action="/app">
      {category&&<input type="hidden" name="category" value={category}/>}<input type="hidden" name="view" value={view}/>
      <label htmlFor="money-search">Search opportunities</label><div className="money-actions"><input id="money-search" name="q" defaultValue={query} maxLength={100} placeholder="Customer, vehicle or work…"/><button className="btn secondary">Search</button></div>
    </form>
    <h2>{category?categoryLabels[category]:'Follow-up list'} <span className="muted">({data.total})</span></h2>
    {!data.items.length&&<div className="card"><h3>Nothing here right now</h3>
      <p>Lists fill from signed declines, unsigned estimates after 2 days, unpaid invoices after 3 days, paid visits 6–24 months ago, and entered service dates.</p>
      <p>Add declined work or a next-service date from a <Link href="/app/customers">vehicle record</Link>. Missing history is never invented.</p>
    </div>}
    {data.items.map(item=><article className="card money-opportunity" key={`${item.category}:${item.subjectId}`}>
      <div className="money-opportunity-head"><div><span className="pill">{categoryLabels[item.category]}</span><h3><Link href={`/app/customers/${item.customerId}`}>{item.customerName}</Link></h3>
        {item.vehicleId&&<Link href={`/app/customers/${item.customerId}/vehicles/${item.vehicleId}`}>{item.vehicleLabel||'Vehicle'}</Link>}</div>
        <strong>{item.category==='lapsed'?'Average visit (est.): ':''}{money(item.amountCents)}</strong></div>
      <p>{item.reason}</p><p className="muted">Recorded {date(item.occurredAt,data.timezone)} · {item.status.replaceAll('_',' ')}</p>
      {item.renewFirst&&<p className="notice">Expired estimate — renew it before asking the customer to authorize work.</p>}
      {!item.phone&&!item.email&&<p className="notice">No phone or email recorded. Add contact details or follow up in person.</p>}
      <div className="money-actions">{item.phone&&<a href={`tel:${item.phone}`}>{item.phone}</a>}{item.email&&<a href={`mailto:${item.email}`}>{item.email}</a>}
        {(item.category==='declined'||item.category==='open_estimate')&&<Link href="/app/estimates">Estimate history</Link>}
        {item.category==='unpaid_invoice'&&<Link href="/app/invoices">Invoice history</Link>}
        {!readOnly&&item.status!=='dismissed'&&(!item.snoozedUntil||item.snoozedUntil<=data.today)&&<>
          <ActionForm action={startRecoveryWorkAction} hidden={{category:item.category,subjectId:item.subjectId,destination:'appointment'}} submitLabel="Book appointment" variant="secondary"/>
          <ActionForm action={startRecoveryWorkAction} hidden={{category:item.category,subjectId:item.subjectId,destination:'job'}} submitLabel="New job / re-quote" variant="secondary"/>
        </>}
      </div>
      <p>Last manual contact: {item.lastContactAt?`${date(item.lastContactAt,data.timezone)} (${item.lastContactMethod?.replaceAll('_',' ')})`:'None recorded'}</p>
      {item.snoozedUntil&&<p>Snoozed until {item.snoozedUntil}</p>}{item.dismissedReason&&<p>Dismissed: {item.dismissedReason}</p>}
      <Controls item={{...item,snoozedUntil:item.snoozedUntil&&item.snoozedUntil>data.today?item.snoozedUntil:null}} readOnly={readOnly}/>
    </article>)}
    <div className="money-actions" aria-label="Opportunity pages">{page>1&&<Link href={url(category,page-1)}>Previous</Link>}{page*50<data.total&&<Link href={url(category,page+1)}>Next 50</Link>}</div>
  </section>;
}
