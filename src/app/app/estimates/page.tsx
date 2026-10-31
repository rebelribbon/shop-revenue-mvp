import { getBusinessProfile } from "@/domain/business-profile";
import { workspaceLabels } from "@/lib/business-types";
import Link from "next/link";
import { WorkNavigation } from "@/components/work-navigation";
import { EstimateLink } from "@/components/estimate-publisher";
import { AuthorizedTotal, EstimateDocument, formatMoney } from "@/components/estimate-document";
import { ActionForm } from "@/components/action-form";
import { withTenant } from "@/db/tenant";
import { listEstimates } from "@/domain/estimates";
import { listInvoices } from "@/domain/invoices";
import { requireShopSession } from "@/server/views/shop";
import { revokeEstimateAction } from "@/server/actions/estimates";

export default async function EstimatesPage({searchParams}:{searchParams:Promise<{jobId?:string}>}) {
 const s=await requireShopSession('/app/estimates');
 const {jobId}=await searchParams;
 const [all,invoices,profile]=await withTenant(s.businessId,s.actor,tx=>Promise.all([listEstimates(tx),listInvoices(tx),getBusinessProfile(tx)]));
 const rows=jobId?all.filter(e=>e.quoteId===jobId):all;
 return <main id="main-content" tabIndex={-1}>
  <h1>Estimates</h1><WorkNavigation current="estimates" businessType={profile?.businessType}/>
  <p className="muted">Review customer decisions. Open an estimate to see its fixed prices and authorization history.</p>
  <Link href="/app/jobs?new=1" className="btn primary" data-page-primary>{workspaceLabels(profile?.businessType??"automotive").newJob}</Link>
  {jobId&&<p><Link href="/app/estimates">Show all estimates</Link></p>}
  {!rows.length&&<div className="card"><h2>No estimates published yet</h2><p>Start a job, price the work, then publish its customer estimate.</p></div>}
  {rows.map(e=>{
   const latest=all.find(x=>x.quoteId===e.quoteId)?.id===e.id;
   const invoice=invoices.find(i=>i.quoteId===e.quoteId&&!i.voidedAt);
   return <article className="card" key={e.id}>
    <h2>{e.snapshot.title} · Version {e.version}</h2><p>{e.snapshot.customerName}</p>
    <div className="record-meta"><strong>Estimate: {formatMoney(e.snapshot.totalCents)}</strong><span className="pill">{e.authorization?(e.authorization.approvedLineIds.length?'Authorized work':'All items declined'):'Awaiting customer decision'}</span><span className="muted">{!latest?'Earlier version':e.revokedAt?'Customer link revoked':new Date()>e.expiresAt?'Customer link expired':'Customer link active'}</span></div>
    <div className="money-actions"><Link href={`/app/jobs?job=${e.quoteId}`}>Open job</Link>{latest&&invoice?<Link href={`/app/invoices?invoiceId=${invoice.id}`}>Open invoice</Link>:latest&&e.authorization&&e.authorization.approvedLineIds.length>0?<Link href={`/app/invoices?new=1&versionId=${e.id}`}>Continue to invoice</Link>:null}</div>
    <details className="record-details"><summary>View estimate &amp; authorization</summary>
     {e.supplementReason&&<p>Change: {e.supplementReason}</p>}<EstimateDocument snapshot={e.snapshot}/>
     {e.authorization?<section><h3>Authorization history</h3><AuthorizedTotal snapshot={e.snapshot} ids={e.authorization.approvedLineIds}/><p>Signed by {e.authorization.signerName} · {e.authorization.createdAt.toLocaleString('en-US',{timeZone:'America/Chicago'})}</p><ul>{e.snapshot.lines.map(line=><li key={line.id}>{line.description}: {e.authorization!.approvedLineIds.includes(line.id)?'Approved':'Declined'}</li>)}</ul><p>{e.authorization.consentText}</p></section>:<p>Awaiting customer decision</p>}
     {!e.revokedAt&&<><EstimateLink id={e.id}/><ActionForm action={revokeEstimateAction} hidden={{id:e.id}} submitLabel="Revoke customer link" variant="danger" confirm="Revoke this estimate link? Existing signature evidence is retained."/></>}
    </details>
   </article>;
  })}
 </main>;
}
