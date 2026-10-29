import Link from 'next/link';
import {withTenant} from '@/db/tenant';
import {listRevenue} from '@/domain/revenue';
import {requireShopSession} from '@/server/views/shop';
import {RevenueSummary,revenueMoney} from '@/components/revenue-summary';
import {ActionForm} from '@/components/action-form';
import {refreshRevenueAction} from '@/server/actions/revenue';
export default async function RevenuePage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const s=await requireShopSession('/app/revenue'),params=await searchParams;
 const month=typeof params.month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(params.month)?params.month:undefined;
 const page=Math.max(1,Math.min(Number.parseInt(typeof params.page==='string'?params.page:'1',10)||1,10000));
 const data=await withTenant(s.businessId,s.actor,tx=>listRevenue(tx,month,page));
 return <main><p><Link href="/app">← Money Finder</Link></p><h1>Recovered revenue</h1><RevenueSummary {...data}/>
  <form action="/app/revenue" className="card"><label htmlFor="revenue-month">Reporting month</label><input id="revenue-month" type="month" name="month" defaultValue={data.month} required/><button className="btn secondary">View month</button><p className="muted">{data.timezone} · Each invoice has one attribution. Direct and influenced are never added together.</p></form>
  {s.actor.type!=='support'&&<ActionForm action={refreshRevenueAction} submitLabel="Refresh recorded evidence" variant="secondary"/>}
  <h2>Attribution records · all dates</h2>{!data.rows.length&&<section className="card"><h3>No recovered revenue recorded yet</h3><p>Log a real manual contact from Money Finder. Confirm delivery when known, record the actual customer response, then create linked work. Declined-work credit requires recommendation links on the billed lines. Credit appears only after payments are recorded.</p><p>Only owner-confirmed responses qualify for direct recovery. An unanswered attempt alone earns no credit.</p></section>}
  {data.rows.map(({attribution:a,number,customerName,title})=><article className="card" key={a.id}><h3><Link href={`/app/revenue/${a.id}`}>Invoice #{number} · {title}</Link></h3><p>{customerName}</p><p><strong>{a.classification==='direct'?'Directly recovered':a.classification==='influenced'?'Influenced — not recovered':'Reversed / no current credit'}: {revenueMoney(a.amountCents)}</strong></p><p className="muted">{a.ruleCode} · {a.ruleVersion}{a.excluded?' · Owner excluded':''}</p><Link href={`/app/revenue/${a.id}`}>Explanation and history</Link></article>)}
  <div className="money-actions">{page>1&&<Link href={`/app/revenue?month=${data.month}&page=${page-1}`}>Previous</Link>}{page*50<data.total&&<Link href={`/app/revenue?month=${data.month}&page=${page+1}`}>Next 50</Link>}</div>
 </main>;
}
