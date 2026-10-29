import { and, eq } from "drizzle-orm";
import { appointment, recommendation } from "@/db/schema";
import {EstimatePublisher} from "@/components/estimate-publisher";
import Link from "next/link";
import { calculateJob } from "@/domain/job-costing";
import { jobInput } from "@/domain/jobs";
import { withTenant } from "@/db/tenant";
import { listAppointmentChoices } from "@/domain/appointments";
import { listJobs } from "@/domain/jobs";
import { JobEditor } from "@/components/job-editor";
import { requireShopSession } from "@/server/views/shop";
export default async function JobsPage({searchParams}:{searchParams:Promise<{edit?:string;customerId?:string;vehicleId?:string;sourceRecoveryItemId?:string;sourceContactActivityId?:string;sourceAppointmentId?:string}>}){
 const {edit,customerId,vehicleId,sourceRecoveryItemId,sourceContactActivityId,sourceAppointmentId}=await searchParams;
 const s=await requireShopSession("/app/jobs");
 const data=await withTenant(s.businessId,s.actor,async tx=>({options:await listAppointmentChoices(tx),jobs:await listJobs(tx),recommendations:await tx.select({id:recommendation.id,description:recommendation.description,vehicleId:recommendation.vehicleId}).from(recommendation).where(eq(recommendation.businessId,tx.businessId)).limit(1000),sourceAppointment:sourceAppointmentId?(await tx.select().from(appointment).where(and(eq(appointment.businessId,tx.businessId),eq(appointment.id,sourceAppointmentId))))[0]:undefined}));
 const selected=data.jobs.find(j=>j.id===edit);
 const chosenCustomer=data.options.customers.find(c=>c.id===customerId);
 const chosenVehicle=data.options.vehicles.find(v=>v.id===vehicleId&&v.customerId===customerId);
 const initial=selected?{...jobInput.parse(selected.data),jobId:selected.id,expectedVersion:selected.version}:chosenCustomer?{sourceRecoveryItemId:sourceRecoveryItemId??data.sourceAppointment?.sourceRecoveryItemId??undefined,sourceContactActivityId:sourceContactActivityId??data.sourceAppointment?.sourceContactActivityId??undefined,sourceAppointmentId,customerId:chosenCustomer.id,vehicleId:chosenVehicle?.id??'',title:'',parts:[],labor:[]}:undefined;
 const money=(c:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(c/100);
 return <main><h1>Jobs &amp; costing</h1><p><Link href="/app/estimates">Estimates and authorization history</Link></p><p className="muted">Internal job sheets. Amounts exclude tax, overhead and payment fees.</p><JobEditor key={selected?.version??"new"} options={data.options} recommendations={data.recommendations} initial={initial}/><h2>Saved job sheets</h2>{data.jobs.map(j=>{const input=jobInput.parse(j.data);const t=calculateJob(input.parts,input.labor);return <article className="card" key={j.id}><h3>{j.title}</h3><Link href={`/app/jobs?edit=${j.id}`}>Revise job / record actual hours</Link><p>Quoted subtotal: {money(t.subtotalCents)} · Estimated gross profit: {money(t.estimatedGrossProfitCents)}</p><p>Actual gross profit: {t.actualGrossProfitCents===null?"Awaiting actual hours":money(t.actualGrossProfitCents)}</p><ul>{input.parts.map((p,i)=><li key={i}>{p.description} — {p.quantity} × {money(p.unitPriceCents)} (unit cost {money(p.unitCostCents)})</li>)}{input.labor.map((l,i)=><li key={i}>{l.description} — {l.estimatedHoursHundredths/100} quoted hours; {l.actualHoursHundredths===null?"actual time unknown":`${l.actualHoursHundredths/100} actual hours`}</li>)}</ul><EstimatePublisher jobId={j.id} version={j.version}/></article>})}</main>;
}
