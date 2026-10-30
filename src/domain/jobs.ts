import { and, desc, eq, sql } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { z } from "zod";
import { activity, estimateVersion, recommendation } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { validateRecoverySource, validateContactSource, validateAppointmentSource } from "./recovery-source";
import { recordActivity } from "./records";
import { getCustomerWithVehicles, getVehicle } from "./customers";
import { serviceAssetLabel } from "./service-assets";
import { calculateJob } from "./job-costing";
const amount=z.number().int().min(0).max(100000000);
export const jobInput=z.object({jobId:z.uuid().optional(),sourceRecoveryItemId:z.uuid().optional(),sourceContactActivityId:z.uuid().optional(),sourceAppointmentId:z.uuid().optional(),expectedVersion:z.uuid().optional(),customerId:z.uuid(),vehicleId:z.uuid().optional(),serviceAssetId:z.uuid().optional(),title:z.string().trim().min(1).max(200),
 parts:z.array(z.object({recommendationId:z.uuid().optional(),description:z.string().trim().min(1).max(200),quantity:z.number().int().min(1).max(10000),unitCostCents:amount,unitPriceCents:amount})).max(100),
 labor:z.array(z.object({recommendationId:z.uuid().optional(),description:z.string().trim().min(1).max(200),estimatedHoursHundredths:amount.max(100000),actualHoursHundredths:amount.max(100000).nullable(),sellRateCents:amount,costRateCents:amount})).max(100)});
export type JobInput=z.infer<typeof jobInput>;
export async function createJob(tx:TenantTx,input:JobInput){
 const data=jobInput.parse(input);
 await getCustomerWithVehicles(tx,data.customerId);
 if(Boolean(data.vehicleId)===Boolean(data.serviceAssetId)) throw new AppError("VALIDATION","Choose either a vehicle or a property/equipment item.");
 if(data.vehicleId) await getVehicle(tx,data.customerId,data.vehicleId);
 if(data.serviceAssetId) await serviceAssetLabel(tx,data.customerId,data.serviceAssetId);
 await validateRecoverySource(tx,data.sourceRecoveryItemId,data.customerId,data.vehicleId);
 await validateContactSource(tx,data.sourceContactActivityId,data.sourceRecoveryItemId);
 await validateAppointmentSource(tx,data.sourceAppointmentId,data.customerId,data.vehicleId,data.sourceRecoveryItemId,data.sourceContactActivityId,data.serviceAssetId);
 for(const line of [...data.parts,...data.labor])if(line.recommendationId){
  const [rec]=await tx.select().from(recommendation).where(and(eq(recommendation.businessId,tx.businessId),eq(recommendation.id,line.recommendationId),eq(recommendation.customerId,data.customerId),data.vehicleId?eq(recommendation.vehicleId,data.vehicleId):sql`${recommendation.vehicleId} IS NULL`));
  if(rec && data.serviceAssetId && rec.sourceVersionId){const [origin]=await tx.select({serviceAssetId:estimateVersion.serviceAssetId}).from(estimateVersion).where(and(eq(estimateVersion.businessId,tx.businessId),eq(estimateVersion.id,rec.sourceVersionId)));if(origin?.serviceAssetId!==data.serviceAssetId)throw new AppError('VALIDATION','The declined work belongs to a different property or equipment item.');}
  if(!rec)throw new AppError('VALIDATION','The declined-work link must belong to this customer and vehicle.');
 }
 const totals=calculateJob(data.parts,data.labor);const id=data.jobId??crypto.randomUUID();
 if(data.jobId){
 await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${id},0))`);
 const [prior]=await tx.select({version:activity.id,data:activity.data}).from(activity).where(and(eq(activity.businessId,tx.businessId),eq(activity.subjectId,id),eq(activity.kind,"job.costed"))).orderBy(desc(activity.occurredAt),desc(activity.id)).limit(1);
 if(!prior || prior.version!==data.expectedVersion) throw new AppError("CONFLICT","Job changed. Refresh before revising it.");
 const original=jobInput.parse(prior.data);
 if(original.customerId!==data.customerId||original.vehicleId!==data.vehicleId||original.serviceAssetId!==data.serviceAssetId||original.sourceRecoveryItemId!==data.sourceRecoveryItemId||original.sourceContactActivityId!==data.sourceContactActivityId||original.sourceAppointmentId!==data.sourceAppointmentId) throw new AppError("VALIDATION","Create a new job to change its customer or vehicle.");
 }
 await recordActivity(tx,{kind:"job.costed",subjectType:"job",subjectId:id,summary:data.title,data:{...data,totals}});
 await recordActivity(tx,{kind:"job.created",subjectType:data.vehicleId?"vehicle":"customer",subjectId:data.vehicleId??data.customerId,summary:`Job costed: ${data.title}`,data:{jobId:id}});
 return {id};
}
export async function listJobs(tx:TenantTx){
 const rows=await tx.select({version:activity.id,id:activity.subjectId,title:activity.summary,data:activity.data,createdAt:activity.occurredAt}).from(activity)
 .where(and(eq(activity.businessId,tx.businessId),eq(activity.kind,"job.costed"),eq(activity.subjectType,"job"))).orderBy(desc(activity.occurredAt),desc(activity.id)).limit(1000);
 return rows.filter((r,i)=>rows.findIndex(x=>x.id===r.id)===i).slice(0,100);
}
