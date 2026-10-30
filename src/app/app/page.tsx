import Link from "next/link";
import { redirect } from "next/navigation";
import { withTenant } from "@/db/tenant";
import { requireShopSession } from "@/server/views/shop";
import { getBusinessProfile } from "@/domain/business-profile";
import { listTodayTomorrow } from "@/domain/appointments";
import { listEstimates } from "@/domain/estimates";
import { listInvoices } from "@/domain/invoices";
import { getMoneyFinder } from "@/domain/money-finder";

export default async function HomePage({searchParams}:{searchParams:Promise<{denied?:string;category?:string;view?:string;q?:string;page?:string}>}) {
 const params=await searchParams;
 // Existing bookmarked Money Finder filters keep their meaning.
 if(params.category||params.view||params.q||params.page){
  const query=new URLSearchParams(Object.entries(params).filter(([key,value])=>key!=='denied'&&typeof value==='string') as [string,string][]);
  redirect(`/app/opportunities?${query}`);
 }
 const s=await requireShopSession('/app');
 const [profile,days,estimates,invoices,money]=await withTenant(s.businessId,s.actor,tx=>Promise.all([
  getBusinessProfile(tx),listTodayTomorrow(tx),listEstimates(tx),listInvoices(tx),getMoneyFinder(tx,{view:'active',page:1,query:''}),
 ]));
 const latest=estimates.filter((e,i,a)=>a.findIndex(x=>x.quoteId===e.quoteId)===i);
 const waiting=latest.filter(e=>!e.authorization&&!e.revokedAt&&e.expiresAt>new Date());
 const unpaid=invoices.filter(i=>!i.voidedAt&&i.balanceCents>0);
 const visits=days.today.filter(a=>a.status==='scheduled');
 const date=new Date().toLocaleDateString('en-US',{timeZone:days.timezone,weekday:'long',month:'long',day:'numeric'});
 return <main id="main-content" tabIndex={-1}>
  {params.denied&&<p role="status" className="notice error">Only the owner can open that page.</p>}
  <div className="page-heading"><p className="eyebrow">Your workspace</p><h1>Home</h1><p className="muted">{date} · {profile?.dba||profile?.legalName}</p></div>
  <Link className="btn primary" data-page-primary href="/app/jobs?new=1">New job / estimate</Link>
  {(!profile?.phoneE164||!profile.addressLine1)&&<div className="notice banner"><p>Finish your business details so appointments and documents use the right information.</p><Link href="/app/settings/business">Finish setup</Link></div>}
  <div className="overview-metrics">
   <Link className="card overview-metric" href="/app/schedule"><span>Scheduled today</span><strong>{visits.length}</strong><span className="muted">Open the schedule →</span></Link>
   <Link className="card overview-metric" href="/app/opportunities"><span>Follow-up opportunities</span><strong>{money.total}</strong><span className="muted">Open Money Finder →</span></Link>

  </div>
  <div className="overview-columns">
   <section className="card"><div className="section-heading"><h2>Today’s appointments</h2><Link href="/app/schedule">Full schedule</Link></div>
    {!visits.length&&<p className="muted">Nothing scheduled for today. Add a visit or start a job when a customer arrives.</p>}
    {visits.slice(0,5).map(a=><div className="overview-row" key={a.id}><strong>{a.startsAt.toLocaleTimeString('en-US',{timeZone:days.timezone,hour:'numeric',minute:'2-digit'})}</strong><div><Link href={`/app/customers/${a.customerId}`}>{a.customerName}</Link><p>{a.reason||'Appointment'}</p>{a.serviceAssetName&&<p className="muted">{a.serviceAssetName} · {a.serviceAddress}</p>}</div></div>)}
    <Link className="btn secondary" href="/app/schedule?new=1">Schedule a visit</Link>
   </section>
   <section className="card"><h2>Next steps on recent work</h2><p className="muted">Pick up where you left off.</p>
    <div className="overview-row"><div><strong>{waiting.length} awaiting customer approval</strong><p>Review estimates and their latest decisions.</p></div><Link href="/app/estimates">Estimates</Link></div>
    <div className="overview-row"><div><strong>{unpaid.length} recent invoices with a balance</strong><p>Review payments and outstanding amounts.</p></div><Link href="/app/invoices">Invoices</Link></div>
    <div className="overview-row"><div><strong>Jobs and labor costs</strong><p>Open a saved job or record actual hours.</p></div><Link href="/app/jobs">Jobs</Link></div>
   </section>
  </div>
  <section className="card"><h2>Start with a customer</h2><p>Find their contact details, vehicles or properties, work history and notes in one place.</p><div className="money-actions"><Link href="/app/customers">Find a customer</Link><Link href="/app/customers/new">Add a customer</Link></div></section>
 </main>;
}
