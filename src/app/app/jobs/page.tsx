import {EstimatePublisher} from "@/components/estimate-publisher";
import Link from "next/link";
import { calculateJob } from "@/domain/job-costing";
import { jobInput } from "@/domain/jobs";
import { withTenant } from "@/db/tenant";
import { listAppointmentChoices } from "@/domain/appointments";
import { listJobs } from "@/domain/jobs";
import { JobEditor } from "@/components/job-editor";
import { requireShopSession } from "@/server/views/shop";
export default async function JobsPage({searchParams}:{searchParams:Promise<{edit?:string}>}){
 const {edit}=await searchParams;
 const s=await requireShopSession("/app/jobs");
 const data=await withTenant(s.businessId,s.actor,async tx=>({options:await listAppointmentChoices(tx),jobs:await listJobs(tx)}));
 const selected=data.jobs.find(j=>j.id===edit);
 const initial=selected?{...jobInput.parse(selected.data),jobId:selected.id,expectedVersion:selected.version}:undefined;
 const money=(c:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(c/100);
 return <main><h1>Jobs &amp; costing</h1><p className="muted">Internal job sheets. Amounts exclude tax, overhead and payment fees.</p><JobEditor key={selected?.version??"new"} options={data.options} initial={initial}/><h2>Saved job sheets</h2>{data.jobs.map(j=>{const input=jobInput.parse(j.data);const t=calculateJob(input.parts,input.labor);return <article className="card" key={j.id}><h3>{j.title}</h3><Link href={`/app/jobs?edit=${j.id}`}>Revise job / record actual hours</Link><p>Quoted subtotal: {money(t.subtotalCents)} · Estimated gross profit: {money(t.estimatedGrossProfitCents)}</p><p>Actual gross profit: {t.actualGrossProfitCents===null?"Awaiting actual hours":money(t.actualGrossProfitCents)}</p><ul>{input.parts.map((p,i)=><li key={i}>{p.description} — {p.quantity} × {money(p.unitPriceCents)} (unit cost {money(p.unitCostCents)})</li>)}{input.labor.map((l,i)=><li key={i}>{l.description} — {l.estimatedHoursHundredths/100} quoted hours; {l.actualHoursHundredths===null?"actual time unknown":`${l.actualHoursHundredths/100} actual hours`}</li>)}</ul><EstimatePublisher jobId={j.id} version={j.version}/></article>})}</main>;
}
