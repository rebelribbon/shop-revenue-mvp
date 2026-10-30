import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { activity, appointment, business, estimateAuthorization, estimateRecommendationLine, estimateVersion, invoice, invoicePayment, recoveryItem, revenueAttribution, revenueAttributionEvent } from '@/db/schema';
import type { TenantTx } from '@/db/tenant';
import { AppError, notFound } from '@/lib/errors';
import { assertOwner } from './membership';
import { audit, type RequestMeta } from './records';
import { evaluateRevenue, REVENUE_RULE_VERSION, type RevenueContact, type RevenueDecision, type RevenueInvoice, type RevenueResponse } from './revenue-rules';
export async function lockRevenue(tx:TenantTx){
 await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'revenue:'+tx.businessId},0))`);
}
const dataObject=(value:unknown)=>value&&typeof value==='object'?value as Record<string,unknown>:{};
export async function revenueInputs(tx:TenantTx,customerId?:string){
 const selected=tx.select({id:invoice.id}).from(invoice).where(and(eq(invoice.businessId,tx.businessId),customerId?eq(invoice.customerId,customerId):undefined));
 const selectedVersions=tx.select({id:invoice.versionId}).from(invoice).where(and(eq(invoice.businessId,tx.businessId),customerId?eq(invoice.customerId,customerId):undefined));
 const [docs,versions,auths,payments,items,events,links,appointments]=await Promise.all([
  tx.select().from(invoice).where(and(eq(invoice.businessId,tx.businessId),customerId?eq(invoice.customerId,customerId):undefined)),
  tx.select().from(estimateVersion).where(and(eq(estimateVersion.businessId,tx.businessId),inArray(estimateVersion.id,selectedVersions))),
  tx.select().from(estimateAuthorization).where(and(eq(estimateAuthorization.businessId,tx.businessId),inArray(estimateAuthorization.versionId,selectedVersions))),
  tx.select().from(invoicePayment).where(and(eq(invoicePayment.businessId,tx.businessId),inArray(invoicePayment.invoiceId,selected))),
  tx.select().from(recoveryItem).where(and(eq(recoveryItem.businessId,tx.businessId),customerId?eq(recoveryItem.customerId,customerId):undefined)),
  tx.select().from(activity).where(and(eq(activity.businessId,tx.businessId),inArray(activity.kind,['recovery.contact','recovery.responded']),customerId?eq(activity.subjectId,customerId):undefined)).orderBy(asc(activity.occurredAt),asc(activity.id)),
  tx.select().from(estimateRecommendationLine).where(and(eq(estimateRecommendationLine.businessId,tx.businessId),inArray(estimateRecommendationLine.versionId,selectedVersions))),
  tx.select().from(appointment).where(and(eq(appointment.businessId,tx.businessId),customerId?eq(appointment.customerId,customerId):undefined)),
 ]);
 const itemMap=new Map(items.map(r=>[r.id,r])),versionMap=new Map(versions.map(r=>[r.id,r])),authMap=new Map(auths.map(r=>[r.id,r])),apptMap=new Map(appointments.map(r=>[r.id,r]));
 const contacts:RevenueContact[]=[],responses:RevenueResponse[]=[];
 for(const event of events){
  const d=dataObject(event.data),r=typeof d.recoveryItemId==='string'?itemMap.get(d.recoveryItemId):undefined;
  if(!r||event.subjectId!==r.customerId)continue;
  if(event.kind==='recovery.contact') contacts.push({id:event.id,recoveryId:r.id,customerId:r.customerId,vehicleId:r.vehicleId,category:r.category,subjectId:r.subjectId,at:event.occurredAt.toISOString(),delivered:d.deliveryConfirmed===true,recommendationIds:Array.isArray(d.recommendationIds)?d.recommendationIds.filter((id):id is string=>typeof id==='string'):[]});
  else if(typeof d.contactActivityId==='string')responses.push({id:event.id,contactId:d.contactActivityId,at:event.occurredAt.toISOString(),ownerConfirmed:d.ownerConfirmed===true});
 }
 const lineMap=new Map(links.map(l=>[`${l.versionId}:${l.lineId}`,l.recommendationId]));
 const paymentMap=new Map<string,typeof payments>();for(const p of payments){const list=paymentMap.get(p.invoiceId)??[];list.push(p);paymentMap.set(p.invoiceId,list);}
 const rows:RevenueInvoice[]=docs.flatMap(i=>{
  const v=versionMap.get(i.versionId),auth=authMap.get(i.authorizationId);if(!v||!auth)return [];
  const appt=v.sourceAppointmentId?apptMap.get(v.sourceAppointmentId):undefined;
  const linkedAppt=appt&&appt.customerId===i.customerId&&appt.vehicleId===i.vehicleId&&appt.serviceAssetId===i.serviceAssetId&&appt.sourceRecoveryItemId===v.sourceRecoveryItemId&&appt.sourceContactActivityId===v.sourceContactActivityId?appt:undefined;
  return [{id:i.id,customerId:i.customerId,vehicleId:i.vehicleId,versionId:v.id,quoteId:v.quoteId,authorizationId:auth.id,authorizedAt:auth.createdAt.toISOString(),createdAt:i.createdAt.toISOString(),workCreatedAt:(linkedAppt?.createdAt??v.createdAt).toISOString(),sourceRecoveryItemId:v.sourceRecoveryItemId,sourceContactActivityId:v.sourceContactActivityId,sourceAppointmentId:linkedAppt?.id??null,voided:!!i.voidedAt,disputed:!!i.disputeOpen,totalCents:i.totalCents,subtotalCents:i.snapshot.subtotalCents,
   lines:i.snapshot.lines.map(l=>({...l,recommendationId:lineMap.get(`${v.id}:${l.id}`)})),payments:(paymentMap.get(i.id)??[]).map(p=>({id:p.id,amountCents:p.amountCents,at:p.createdAt.toISOString(),reversesPaymentId:p.reversesPaymentId}))}];
 });
 return {invoices:rows,contacts,responses};
}
const canonical=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const amount=(d:RevenueDecision|undefined,classification:'direct'|'influenced')=>d?.classification===classification?d.amountCents:0;
export async function reconcileRevenue(tx:TenantTx,meta:RequestMeta,reason='Recorded evidence changed',customerId?:string){
 await lockRevenue(tx);
 const inputs=await revenueInputs(tx,customerId);
 const existing=await tx.select().from(revenueAttribution).where(eq(revenueAttribution.businessId,tx.businessId));
 const byInvoice=new Map(existing.map(r=>[r.invoiceId,r]));
 const decisions=evaluateRevenue(inputs.invoices,inputs.contacts,inputs.responses,new Set(existing.filter(r=>r.excluded).map(r=>r.invoiceId)));
 const changed=[...decisions].filter(([id,d])=>{const old=byInvoice.get(id);return old?canonical(old.decision)!==canonical(d):d.amountCents>0;});
 // Release influenced-contact allocations together, then assign the deterministic
 // final decisions. Intermediate state is never visible outside this transaction.
 for(const [id] of changed){const old=byInvoice.get(id);if(old?.classification==='influenced')await tx.update(revenueAttribution).set({classification:'none',amountCents:0}).where(and(eq(revenueAttribution.businessId,tx.businessId),eq(revenueAttribution.id,old.id)));}
 for(const [id,decision] of changed){
  const old=byInvoice.get(id),before=old?.decision as RevenueDecision|undefined,revision=(old?.revision??0)+1;
  const values={revision,classification:decision.classification,amountCents:decision.amountCents,contactActivityId:decision.contactId,responseActivityId:decision.responseId,recoveryItemId:decision.recoveryId,ruleCode:decision.ruleCode,ruleVersion:REVENUE_RULE_VERSION,decision};
  const row=old?(await tx.update(revenueAttribution).set(values).where(and(eq(revenueAttribution.businessId,tx.businessId),eq(revenueAttribution.id,old.id))).returning())[0]:
   (await tx.insert(revenueAttribution).values({businessId:tx.businessId,createdByUserId:tx.actor.type==='user'?tx.actor.id:null,invoiceId:id,...values}).returning())[0];
  const why=before?.classification==='influenced'&&decision.classification==='direct'?'superseded_by_direct':reason;
  const [event]=await tx.insert(revenueAttributionEvent).values({businessId:tx.businessId,createdByUserId:tx.actor.type==='user'?tx.actor.id:null,attributionId:row.id,revision,directDeltaCents:amount(decision,'direct')-amount(before,'direct'),influencedDeltaCents:amount(decision,'influenced')-amount(before,'influenced'),reason:why,before:before??{},after:decision,ruleVersion:REVENUE_RULE_VERSION}).returning();
  const source=inputs.invoices.find(i=>i.id===id)!;
  await audit(tx,meta,{action:'revenue.attribution_evaluated',targetType:'revenue_attribution',targetId:row.id,before:before??null,after:{...decision,eventId:event.id,versionId:source.versionId,authorizationId:source.authorizationId,sourceAppointmentId:source.sourceAppointmentId,reason:why}});
 }
 await tx.execute(sql`SELECT app.enqueue_job('reconcile_revenue',jsonb_build_object('business_id',${tx.businessId}::text),
  ((date_trunc('day',now() AT TIME ZONE timezone)+interval '1 day 3 hours') AT TIME ZONE timezone),5,
  'revenue:'||${tx.businessId}||':'||((now() AT TIME ZONE timezone)::date+1)::text) FROM app.business WHERE id=${tx.businessId}
  AND EXISTS(SELECT 1 FROM app.invoice_payment WHERE business_id=${tx.businessId} AND created_at>=now()-interval '120 days')`);
 return {changed:changed.length};
}
export async function reviewRevenue(tx:TenantTx,meta:RequestMeta,id:string,excluded:boolean,reason:string){
 await assertOwner(tx);if(!reason.trim())throw new AppError('VALIDATION','Enter a reason for this correction.');
 await lockRevenue(tx);
 const [row]=await tx.select().from(revenueAttribution).where(and(eq(revenueAttribution.businessId,tx.businessId),eq(revenueAttribution.id,id)));
 if(!row)throw notFound('That attribution');
 await tx.update(revenueAttribution).set({excluded}).where(and(eq(revenueAttribution.businessId,tx.businessId),eq(revenueAttribution.id,id)));
 await audit(tx,meta,{action:excluded?'revenue.owner_reversed':'revenue.owner_restored',targetType:'revenue_attribution',targetId:id,before:{excluded:row.excluded},after:{excluded,reason}});
 await reconcileRevenue(tx,meta,`${excluded?'Owner reversal':'Owner restored evaluation'}: ${reason}`);
 return {id};
}
export async function listRevenue(tx:TenantTx,month?:string,page=1){
 const [shop]=await tx.select({timezone:business.timezone}).from(business).where(eq(business.id,tx.businessId));
 const current=new Intl.DateTimeFormat('en-CA',{timeZone:shop.timezone,year:'numeric',month:'2-digit'}).formatToParts(new Date());
 const selected=month??`${current.find(p=>p.type==='year')!.value}-${current.find(p=>p.type==='month')!.value}`;
 const summary=await tx.execute(sql`SELECT coalesce(sum(direct_delta_cents),0)::text AS direct,coalesce(sum(influenced_delta_cents),0)::text AS influenced FROM app.revenue_attribution_event WHERE business_id=${tx.businessId} AND to_char(created_at AT TIME ZONE ${shop.timezone},'YYYY-MM')=${selected}`);
 const [count]=await tx.select({n:sql<number>`count(*)::int`}).from(revenueAttribution).where(eq(revenueAttribution.businessId,tx.businessId));
 const rows=await tx.select({attribution:revenueAttribution,number:invoice.number,customerName:sql<string>`${invoice.snapshot}->>'customerName'`,title:sql<string>`${invoice.snapshot}->>'title'`}).from(revenueAttribution).innerJoin(invoice,and(eq(invoice.businessId,revenueAttribution.businessId),eq(invoice.id,revenueAttribution.invoiceId))).where(eq(revenueAttribution.businessId,tx.businessId)).orderBy(desc(revenueAttribution.updatedAt),desc(revenueAttribution.id)).limit(50).offset((page-1)*50);
 return {month:selected,timezone:shop.timezone,direct:String(summary.rows[0].direct),influenced:String(summary.rows[0].influenced),rows,total:count.n};
}
export async function revenueDetail(tx:TenantTx,id:string){
 const [row]=await tx.select().from(revenueAttribution).where(and(eq(revenueAttribution.businessId,tx.businessId),eq(revenueAttribution.id,id)));
 if(!row)throw notFound('That attribution');
 const [doc]=await tx.select().from(invoice).where(and(eq(invoice.businessId,tx.businessId),eq(invoice.id,row.invoiceId)));
 const events=await tx.select().from(revenueAttributionEvent).where(and(eq(revenueAttributionEvent.businessId,tx.businessId),eq(revenueAttributionEvent.attributionId,id))).orderBy(desc(revenueAttributionEvent.revision));
 const references=events.flatMap(e=>{const d=dataObject(e.after);return [d.contactId,d.responseId].filter((v):v is string=>typeof v==='string');});
 const evidence=references.length?await tx.select().from(activity).where(and(eq(activity.businessId,tx.businessId),inArray(activity.id,[...new Set(references)]))):[];
 const [shop]=await tx.select({timezone:business.timezone}).from(business).where(eq(business.id,tx.businessId));
 return {row,invoice:doc,events,evidence,timezone:shop.timezone};
}

export async function recentRecoveryFollowups(tx:TenantTx){
 const rows=await tx.execute(sql`SELECT r.id,r.category,r.subject_id AS "subjectId",r.status,r.customer_id AS "customerId",c.display_name AS "customerName",
  r.last_contact_at AS "lastContactAt",r.last_contact_method AS "method",concat_ws(' ',v.year,v.make,v.model,v.plate) AS "vehicleLabel"
  FROM app.recovery_item r JOIN app.customer c ON c.business_id=r.business_id AND c.id=r.customer_id
  LEFT JOIN app.vehicle v ON v.business_id=r.business_id AND v.id=r.vehicle_id
  WHERE r.business_id=${tx.businessId} AND r.last_contact_at IS NOT NULL AND c.status='active' AND NOT c.do_not_contact AND (r.vehicle_id IS NULL OR v.status='active')
  ORDER BY r.last_contact_at DESC,r.id DESC LIMIT 50`);
 return rows.rows as unknown as {id:string;category:'declined'|'open_estimate'|'unpaid_invoice'|'lapsed'|'service_due';subjectId:string;status:string;customerId:string;customerName:string;lastContactAt:string;method:string;vehicleLabel:string}[];
}
