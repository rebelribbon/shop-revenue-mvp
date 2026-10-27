import { and, desc, eq, sql } from "drizzle-orm";
import { activity, business, estimateAuthorization, estimateVersion, type EstimateSnapshot } from "@/db/schema";
import { type TenantTx, runInContext } from "@/db/tenant";
import { jobInput } from "./jobs";
import { getCustomerWithVehicles,getVehicle } from "./customers";
import { newToken,hashToken,isWellFormedToken } from "@/lib/tokens";
import { AppError,notFound } from "@/lib/errors";
import { audit,recordActivity,type RequestMeta } from "./records";
export const CONSENT="I have reviewed this estimate version. I authorize only the selected items at the displayed prices and decline all unselected items. My typed name is my electronic signature.";
export async function freezeEstimate(tx:TenantTx,meta:RequestMeta,input:{jobId:string;expectedJobVersion:string;taxBps:number;supplementReason:string;terms:string}){
 await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.jobId},0))`);
 const [job]=await tx.select().from(activity).where(and(eq(activity.businessId,tx.businessId),eq(activity.subjectId,input.jobId),eq(activity.kind,"job.costed"))).orderBy(desc(activity.occurredAt),desc(activity.id)).limit(1);
 if(!job) throw notFound("That job");
 if(job.id!==input.expectedJobVersion) throw new AppError("CONFLICT","The job changed. Refresh before publishing.");
 const data=jobInput.parse(job.data);
 const c=await getCustomerWithVehicles(tx,data.customerId);const v=await getVehicle(tx,data.customerId,data.vehicleId);
 const [shop]=await tx.select().from(business).where(eq(business.id,tx.businessId));
 const [prior]=await tx.select().from(estimateVersion).where(and(eq(estimateVersion.businessId,tx.businessId),eq(estimateVersion.quoteId,input.jobId))).orderBy(desc(estimateVersion.version)).limit(1);
 if(prior&&!input.supplementReason.trim()) throw new AppError("VALIDATION","Explain the change for this new version or supplement.");
 const lines:EstimateSnapshot["lines"]=[...data.parts.map((p,i)=>({id:`part-${i}`,description:p.description,kind:"part" as const,quantity:p.quantity,unitPriceCents:p.unitPriceCents,totalCents:p.quantity*p.unitPriceCents})),...data.labor.map((l,i)=>({id:`labor-${i}`,description:l.description,kind:"labor" as const,quantity:l.estimatedHoursHundredths/100,unitPriceCents:l.sellRateCents,totalCents:Math.round(l.estimatedHoursHundredths*l.sellRateCents/100)}))];
 if(!lines.length) throw new AppError("VALIDATION","Add work to the job before publishing.");
 const subtotalCents=lines.reduce((a,l)=>a+l.totalCents,0),taxCents=Math.round(subtotalCents*input.taxBps/10000);
 const snapshot:EstimateSnapshot={title:data.title,shopName:shop.dba||shop.legalName,customerName:c.customer.displayName,vehicleLabel:[v.year,v.make,v.model,v.plate].filter(Boolean).join(" ")||"Vehicle",lines,subtotalCents,taxBps:input.taxBps,taxCents,totalCents:subtotalCents+taxCents,terms:input.terms};
 // Superseding a version revokes its link but never removes its signature evidence.
 await tx.update(estimateVersion).set({revokedAt:new Date()}).where(and(eq(estimateVersion.businessId,tx.businessId),eq(estimateVersion.quoteId,input.jobId)));
 const token=newToken();const [row]=await tx.insert(estimateVersion).values({businessId:tx.businessId,createdByUserId:tx.actor.id,quoteId:input.jobId,version:(prior?.version??0)+1,customerId:data.customerId,vehicleId:data.vehicleId,snapshot,supplementReason:input.supplementReason||null,tokenHash:token.hash,expiresAt:new Date(Date.now()+30*86400000)}).returning();
 await audit(tx,meta,{action:"estimate.published",targetType:"estimate_version",targetId:row.id,after:{version:row.version,totalCents:snapshot.totalCents}});
 await recordActivity(tx,{kind:"estimate.published",subjectType:"vehicle",subjectId:data.vehicleId,summary:`Estimate version ${row.version} published`,data:{versionId:row.id}});
 return {id:row.id,version:row.version,path:`/estimate/${token.token}`};
}
export async function listEstimates(tx:TenantTx){
 return tx.select({id:estimateVersion.id,quoteId:estimateVersion.quoteId,version:estimateVersion.version,snapshot:estimateVersion.snapshot,revokedAt:estimateVersion.revokedAt,expiresAt:estimateVersion.expiresAt,supplementReason:estimateVersion.supplementReason,authorization:estimateAuthorization}).from(estimateVersion).leftJoin(estimateAuthorization,and(eq(estimateAuthorization.businessId,estimateVersion.businessId),eq(estimateAuthorization.versionId,estimateVersion.id))).where(eq(estimateVersion.businessId,tx.businessId)).orderBy(desc(estimateVersion.createdAt),desc(estimateVersion.version)).limit(100);
}
export async function revokeEstimate(tx:TenantTx,meta:RequestMeta,id:string){
 const [row]=await tx.update(estimateVersion).set({revokedAt:new Date()}).where(and(eq(estimateVersion.businessId,tx.businessId),eq(estimateVersion.id,id))).returning();if(!row)throw notFound("That estimate");
 await audit(tx,meta,{action:"estimate.revoked",targetType:"estimate_version",targetId:id});return {id};
}
export type PublicEstimate={id:string;version:number;snapshot:EstimateSnapshot;expiresAt:string;authorization:null|{signerName:string;approvedLineIds:string[];signedAt:string;consentText:string}};
export async function readPublicEstimate(token:string):Promise<PublicEstimate|null>{
 if(!isWellFormedToken(token))return null;
 return runInContext(null,{type:"customer",id:null},async tx=>{const r=await tx.execute(sql`select app.read_estimate(${hashToken(token)}) as data`);return (r.rows[0]?.data??null) as PublicEstimate|null;});
}
export async function signEstimate(token:string,name:string,ids:string[],meta:RequestMeta){
 if(!isWellFormedToken(token))throw notFound("That estimate");
 return runInContext(null,{type:"customer",id:null},async tx=>{await tx.execute(sql`select app.authorize_estimate(${hashToken(token)},${name},${JSON.stringify(ids)}::jsonb,${meta.ip??null},${meta.requestId})`);return {signed:true};});
}

export async function rotateEstimateLink(tx:TenantTx,meta:RequestMeta,id:string){
 const token=newToken();const [row]=await tx.update(estimateVersion).set({tokenHash:token.hash,expiresAt:new Date(Date.now()+30*86400000)}).where(and(eq(estimateVersion.businessId,tx.businessId),eq(estimateVersion.id,id),sql`${estimateVersion.revokedAt} IS NULL`)).returning();
 if(!row)throw notFound("That active estimate");
 await audit(tx,meta,{action:"estimate.link_rotated",targetType:"estimate_version",targetId:id});
 return {id,path:`/estimate/${token.token}`};
}
