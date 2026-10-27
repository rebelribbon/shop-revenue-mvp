import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { activity } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { recordActivity } from "./records";
import { getCustomerWithVehicles, getVehicle } from "./customers";
import { calculateJob } from "./job-costing";
const amount=z.number().int().min(0).max(100000000);
export const jobInput=z.object({customerId:z.uuid(),vehicleId:z.uuid(),title:z.string().trim().min(1).max(200),
 parts:z.array(z.object({description:z.string().trim().min(1).max(200),quantity:z.number().int().min(1).max(10000),unitCostCents:amount,unitPriceCents:amount})).max(100),
 labor:z.array(z.object({description:z.string().trim().min(1).max(200),estimatedHoursHundredths:amount.max(100000),actualHoursHundredths:amount.max(100000).nullable(),sellRateCents:amount,costRateCents:amount})).max(100)});
export type JobInput=z.infer<typeof jobInput>;
export async function createJob(tx:TenantTx,input:JobInput){
 const data=jobInput.parse(input);
 await getCustomerWithVehicles(tx,data.customerId); await getVehicle(tx,data.customerId,data.vehicleId);
 const totals=calculateJob(data.parts,data.labor);const id=crypto.randomUUID();
 await recordActivity(tx,{kind:"job.costed",subjectType:"job",subjectId:id,summary:data.title,data:{...data,totals}});
 await recordActivity(tx,{kind:"job.created",subjectType:"vehicle",subjectId:data.vehicleId,summary:`Job costed: ${data.title}`,data:{jobId:id}});
 return {id};
}
export async function listJobs(tx:TenantTx){
 return tx.select({id:activity.subjectId,title:activity.summary,data:activity.data,createdAt:activity.occurredAt}).from(activity)
 .where(and(eq(activity.businessId,tx.businessId),eq(activity.kind,"job.costed"),eq(activity.subjectType,"job"))).orderBy(desc(activity.occurredAt)).limit(100);
}
