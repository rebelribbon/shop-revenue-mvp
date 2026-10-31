import { isAutomotive, workspaceLabels } from "@/lib/business-types";
import { notFound } from "next/navigation";
import { WorkNavigation } from "@/components/work-navigation";
import { getBusinessProfile } from "@/domain/business-profile";
import { and, eq } from "drizzle-orm";
import { appointment, estimateVersion, recommendation } from "@/db/schema";
import {EstimatePublisher} from "@/components/estimate-publisher";
import Link from "next/link";
import { WorkspaceIcon } from "@/components/workspace-icon";
import { calculateJob } from "@/domain/job-costing";
import { jobInput } from "@/domain/jobs";
import { withTenant } from "@/db/tenant";
import { listAppointmentChoices } from "@/domain/appointments";
import { listJobs } from "@/domain/jobs";
import { JobEditor } from "@/components/job-editor";
import { requireShopSession } from "@/server/views/shop";
export default async function JobsPage({searchParams}:{searchParams:Promise<{edit?:string;job?:string;new?:string;saved?:string;q?:string;customerId?:string;vehicleId?:string;serviceAssetId?:string;sourceRecoveryItemId?:string;sourceContactActivityId?:string;sourceAppointmentId?:string}>}){
 const {edit,job,new:creating,saved,q,customerId,vehicleId,serviceAssetId,sourceRecoveryItemId,sourceContactActivityId,sourceAppointmentId}=await searchParams;
 const s=await requireShopSession("/app/jobs");
 const data=await withTenant(s.businessId,s.actor,async tx=>({profile:await getBusinessProfile(tx),options:await listAppointmentChoices(tx),jobs:await listJobs(tx),recommendations:await tx.select({id:recommendation.id,description:recommendation.description,vehicleId:recommendation.vehicleId,customerId:recommendation.customerId,serviceAssetId:estimateVersion.serviceAssetId}).from(recommendation).leftJoin(estimateVersion,and(eq(estimateVersion.businessId,recommendation.businessId),eq(estimateVersion.id,recommendation.sourceVersionId))).where(eq(recommendation.businessId,tx.businessId)).limit(1000),sourceAppointment:sourceAppointmentId?(await tx.select().from(appointment).where(and(eq(appointment.businessId,tx.businessId),eq(appointment.id,sourceAppointmentId))))[0]:undefined}));
 const type=data.profile?.businessType??"automotive",auto=isAutomotive(type),labels=workspaceLabels(type);
 const selected=data.jobs.find(j=>j.id===(edit??job));
 if((edit||job)&&!selected)notFound();
 const editing=!!(edit||creating==='1'||customerId||sourceRecoveryItemId||sourceAppointmentId);
 const rows=data.jobs.filter(j=>`${j.title} ${data.options.customers.find(c=>c.id===(j.data as {customerId?:string}).customerId)?.name??''}`.toLowerCase().includes((q??'').toLowerCase().slice(0,100)));
 const chosenCustomer=data.options.customers.find(c=>c.id===customerId);
 const chosenVehicle=data.options.vehicles.find(v=>v.id===vehicleId&&v.customerId===customerId);
 const chosenAsset=data.options.serviceAssets.find(a=>a.id===(serviceAssetId??data.sourceAppointment?.serviceAssetId)&&a.customerId===customerId);
 const initial=selected?{...jobInput.parse(selected.data),jobId:selected.id,expectedVersion:selected.version}:chosenCustomer?{sourceRecoveryItemId:sourceRecoveryItemId??data.sourceAppointment?.sourceRecoveryItemId??undefined,sourceContactActivityId:sourceContactActivityId??data.sourceAppointment?.sourceContactActivityId??undefined,sourceAppointmentId,customerId:chosenCustomer.id,vehicleId:chosenVehicle?.id,serviceAssetId:chosenAsset?.id,title:'',parts:[],labor:[]}:undefined;
 const money=(c:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(c/100);
 return <main id="main-content" tabIndex={-1}>
  <h1>{editing?(selected?'Edit job':labels.newJob):labels.jobs}</h1>
  <WorkNavigation current="jobs" businessType={type}/>
  <p className="muted">{editing?"Add the work, then save to review and publish an estimate.":selected?"Job pricing and customer estimate.":"Open a job to review pricing, labor hours and costs."}</p>
  {editing?<><p><Link href={selected?`/app/jobs?job=${selected.id}`:'/app/jobs'}>← Back to {selected?'job':'jobs'}</Link></p><JobEditor businessType={data.profile?.businessType} key={selected?.version??[customerId,vehicleId,serviceAssetId,sourceRecoveryItemId,sourceContactActivityId,sourceAppointmentId].join(":")} options={data.options} recommendations={data.recommendations} initial={initial}/></>:selected?(()=>{
   const input=jobInput.parse(selected.data),t=calculateJob(input.parts,input.labor);
   return <><p><Link href="/app/jobs">← All jobs</Link></p>{saved==='1'&&<p role="status" className="notice ok">Job sheet saved. Review the pricing, then publish the customer estimate.</p>}
    <article className="card"><h2>{selected.title}</h2><p>{data.options.customers.find(c=>c.id===input.customerId)?.name}</p>
     <div className="money-actions"><Link href={`/app/customers/${input.customerId}`}>Customer overview</Link><Link href={`/app/jobs?edit=${selected.id}`}>Edit costs / record actual hours</Link><Link href={`/app/estimates?jobId=${selected.id}`}>Estimate history</Link></div>
     <div className="record-meta"><strong>Quoted subtotal: {money(t.subtotalCents)}</strong><span>Estimated gross profit: {money(t.estimatedGrossProfitCents)}</span><span>Actual gross profit: {t.actualGrossProfitCents===null?'Awaiting actual hours':money(t.actualGrossProfitCents)}</span></div>
     <details><summary>View parts, labor and costs</summary><ul>{input.parts.map((part,i)=><li key={i}>{part.description} — {part.quantity} × {money(part.unitPriceCents)} (unit cost {money(part.unitCostCents)})</li>)}{input.labor.map((line,i)=><li key={i}>{line.description} — {line.estimatedHoursHundredths/100} quoted hours; {line.actualHoursHundredths===null?'actual time unknown':`${line.actualHoursHundredths/100} actual hours`}</li>)}</ul></details>
     <section className="record-details"><h3>Next: customer estimate</h3><p>Publish a fixed version for the customer to review. Internal costs stay private.</p><EstimatePublisher jobId={selected.id} version={selected.version}/></section>
    </article></>;
  })():<>
   <Link className="btn primary" data-page-primary data-stable-primary href="/app/jobs?new=1">{labels.newJob}</Link>
   <form className="card" method="get"><label htmlFor="job-search">Find a job</label><div className="search-controls"><input id="job-search" name="q" defaultValue={q??''} maxLength={100} placeholder="Job or customer name"/><button className="btn secondary">Search</button></div></form>
   <h2>{auto?"Recent repair jobs":"Recent job sheets"}</h2>{!rows.length&&<div className="card"><h3>{q?'No matching jobs':auto?'No repair jobs yet':'No jobs yet'}</h3><p>{q?'Try another name.':auto?'Start with a customer and vehicle, add parts and labor, then save the repair job.':'Start with a customer, add materials and labor, then save the job.'}</p></div>}
   <div className="job-list">{rows.map(j=>{const input=jobInput.parse(j.data),t=calculateJob(input.parts,input.labor);return <article key={j.id}><Link className="card job-row" href={`/app/jobs?job=${j.id}`} aria-label={`Open job: ${j.title}`}><div><h3>{j.title}</h3><p className="muted">{data.options.customers.find(c=>c.id===input.customerId)?.name}</p></div><div className="job-row-meta"><strong>{money(t.subtotalCents)} quoted</strong><span className="muted">Updated {j.createdAt.toLocaleDateString('en-US',{timeZone:data.profile?.timezone||'America/Chicago'})}</span></div><WorkspaceIcon name="arrow"/></Link></article>;})}</div>
  </>}
 </main>;
}
