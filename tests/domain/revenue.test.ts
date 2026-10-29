import {describe,it,expect} from 'vitest';
import {eq} from 'drizzle-orm';
import {activity,recoveryItem,estimateVersion,estimateRecommendationLine,invoice,revenueAttribution,revenueAttributionEvent} from '@/db/schema';
import {withTenant} from '@/db/tenant';
import {createCustomer,createVehicle} from '@/domain/customers';
import {addRecommendation,updateRecovery,startRecoveryWork} from '@/domain/money-finder';
import {createJob,listJobs} from '@/domain/jobs';
import {freezeEstimate,signEstimate,readPublicEstimate} from '@/domain/estimates';
import {issueInvoice,recordInvoicePayment,reverseInvoicePayment,setInvoiceDispute} from '@/domain/invoices';
import {reconcileRevenue,reviewRevenue,listRevenue,revenueDetail,recentRecoveryFollowups} from '@/domain/revenue';
import {recordActivity} from '@/domain/records';
import {localDateKey} from '@/lib/timezone';
import {meta,seedTenant} from '../helpers/fixtures';
async function fixture(){
 const t=await seedTenant('Revenue',{withStaff:true});
 const c=await withTenant(t.businessId,t.owner.actor,tx=>createCustomer(tx,meta(),{firstName:'Real',lastName:'Revenue'}));
 const v=await withTenant(t.businessId,t.owner.actor,tx=>createVehicle(tx,meta(),{customerId:c.id,make:'Honda'}));
 const rec=await withTenant(t.businessId,t.owner.actor,tx=>addRecommendation(tx,meta(),{customerId:c.id,vehicleId:v.id,description:'Front brakes',amountCents:61200,declinedOn:localDateKey(new Date(),'America/Chicago')}));
 return {...t,customerId:c.id,vehicleId:v.id,recommendationId:rec.id};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
const run=<T>(f:Fixture,fn:Parameters<typeof withTenant<T>>[2])=>withTenant(f.businessId,f.owner.actor,fn);
async function billed(f:Fixture,{response=true,delivery=true}:{response?:boolean;delivery?:boolean}={}){
 const input={category:'declined' as const,subjectId:f.vehicleId};
 const touch=await run(f,tx=>updateRecovery(tx,meta(),{...input,action:'contact',method:'in_person',deliveryConfirmed:delivery,note:'Discussed brake repair at counter'}));
 if(response)await run(f,tx=>updateRecovery(tx,meta(),{...input,action:'responded',note:'Customer asked us to re-quote the brakes'}));
 const source=await run(f,tx=>startRecoveryWork(tx,meta(),{...input,destination:'job'}));
 expect(source.redirectTo).toContain(`sourceContactActivityId=${touch.activityId}`);
 const job=await run(f,tx=>createJob(tx,{sourceRecoveryItemId:source.id,sourceContactActivityId:touch.activityId,customerId:f.customerId,vehicleId:f.vehicleId,title:'Brakes and extra work',parts:[{description:'Re-quoted brakes',quantity:1,unitCostCents:20000,unitPriceCents:64000,recommendationId:f.recommendationId},{description:'Wipers and filter',quantity:1,unitCostCents:6000,unitPriceCents:20200}],labor:[]}));
 const [costed]=await run(f,tx=>listJobs(tx));
 const e=await run(f,tx=>freezeEstimate(tx,meta(),{jobId:job.id,expectedJobVersion:costed.version,taxBps:825,supplementReason:'',terms:''}));
 await signEstimate(e.path.split('/').pop()!,'Customer',['part-0','part-1'],meta());
 const issued=await run(f,tx=>issueInvoice(tx,meta(),{versionId:e.id,dueOn:null,terms:''}));
 const [doc]=await run(f,tx=>tx.select().from(invoice).where(eq(invoice.id,issued.id)));
 return {doc,estimate:e,touch,source};
}
describe('durable revenue attribution',()=>{
 it('continues a real recorded follow-up after its item leaves the active list, without fabricating another contact',async()=>{
  const f=await fixture();
  const evidence=await run(f,async tx=>{const [r]=await tx.insert(recoveryItem).values({businessId:f.businessId,category:'lapsed',subjectId:f.customerId,customerId:f.customerId,status:'contacted',lastContactAt:new Date(),lastContactMethod:'in_person'}).returning();const contact=await recordActivity(tx,{kind:'recovery.contact',subjectType:'customer',subjectId:f.customerId,summary:'Recorded lapsed follow-up',data:{recoveryItemId:r.id,deliveryConfirmed:true,method:'in_person'}});return {r,contact};});
  await run(f,tx=>updateRecovery(tx,meta(),{category:'lapsed',subjectId:f.customerId,action:'responded',note:'Customer responded to the recorded contact'}));
  const source=await run(f,tx=>startRecoveryWork(tx,meta(),{category:'lapsed',subjectId:f.customerId,destination:'job'}));
  expect(source.redirectTo).toContain(`sourceContactActivityId=${evidence.contact.id}`);
  expect((await run(f,tx=>recentRecoveryFollowups(tx))).some(r=>r.id===evidence.r.id)).toBe(true);
 });
 it('records staff responses without upgrading them to owner-confirmed proof',async()=>{
  const f=await fixture();await run(f,tx=>updateRecovery(tx,meta(),{category:'declined',subjectId:f.vehicleId,action:'contact',method:'in_person'}));
  const result=await withTenant(f.businessId,f.staff!.actor,tx=>updateRecovery(tx,meta(),{category:'declined',subjectId:f.vehicleId,action:'responded',note:'Staff noted a response'}));
  const [event]=await run(f,tx=>tx.select().from(activity).where(eq(activity.id,result.activityId)));expect(event.data).toMatchObject({ownerConfirmed:false});
 });

 it('credits real paid lines only, preserves calculation references, and is idempotent',async()=>{
  const f=await fixture(),{doc,estimate}=await billed(f);
  await run(f,tx=>recordInvoicePayment(tx,meta(),{invoiceId:doc.id,amountCents:doc.totalCents,method:'cash',reference:'Receipt'}));
  const [r]=await run(f,tx=>tx.select().from(revenueAttribution));expect(r).toMatchObject({invoiceId:doc.id,classification:'direct',amountCents:64000,ruleCode:'D-DECLINED',revision:1});
  const detail=await run(f,tx=>revenueDetail(tx,r.id));expect(detail.events).toHaveLength(1);expect(detail.events[0].after).toMatchObject({otherSubtotalCents:20200,documentEvidence:{invoiceId:doc.id,versionId:doc.versionId,authorizationId:doc.authorizationId},calculation:{invoiceTotalCents:doc.totalCents,netEligiblePaidCents:doc.totalCents}});
  expect((await run(f,tx=>reconcileRevenue(tx,meta()))).changed).toBe(0);expect(await run(f,tx=>tx.select().from(revenueAttributionEvent))).toHaveLength(1);
  const summary=await run(f,tx=>listRevenue(tx));expect(summary.direct).toBe('64000');expect(summary.influenced).toBe('0');
  expect(JSON.stringify(await readPublicEstimate(estimate.path.split('/').pop()!))).not.toMatch(/recommendationId|sourceContactActivityId|unitCostCents/);
 });
 it('reverses and restores owner corrections with immutable deltas, without moving money',async()=>{
  const f=await fixture(),{doc}=await billed(f);await run(f,tx=>recordInvoicePayment(tx,meta(),{invoiceId:doc.id,amountCents:doc.totalCents,method:'cash',reference:''}));
  const [r]=await run(f,tx=>tx.select().from(revenueAttribution));
  await expect(withTenant(f.businessId,f.staff!.actor,tx=>reviewRevenue(tx,meta(),r.id,true,'Not from follow-up'))).rejects.toThrow(/owner/);
  await run(f,tx=>reviewRevenue(tx,meta(),r.id,true,'Work was already booked independently'));
  expect((await run(f,tx=>listRevenue(tx))).direct).toBe('0');
  await run(f,tx=>reconcileRevenue(tx,meta()));expect((await run(f,tx=>listRevenue(tx))).direct).toBe('0');
  await run(f,tx=>reviewRevenue(tx,meta(),r.id,false,'Verified original response and job link'));
  expect((await run(f,tx=>listRevenue(tx))).direct).toBe('64000');
  const events=await run(f,tx=>tx.select().from(revenueAttributionEvent));expect(events.map(e=>e.directDeltaCents)).toEqual([64000,-64000,64000]);
  await expect(run(f,tx=>tx.delete(revenueAttributionEvent).where(eq(revenueAttributionEvent.id,events[0].id)))).rejects.toThrow();
 });
 it('reduces partial credits and reverses manual payments or disputed balances through the real handlers',async()=>{
  const f=await fixture(),{doc}=await billed(f);
  const p=await run(f,tx=>recordInvoicePayment(tx,meta(),{invoiceId:doc.id,amountCents:Math.floor(doc.totalCents/2),method:'check',reference:'Partial'}));
  let summary=await run(f,tx=>listRevenue(tx));expect(Number(summary.direct)).toBeGreaterThan(31990);expect(Number(summary.direct)).toBeLessThan(32010);
  await run(f,tx=>setInvoiceDispute(tx,meta(),doc.id,'Customer contests repair'));
  expect((await run(f,tx=>listRevenue(tx))).direct).toBe('0');
  await run(f,tx=>setInvoiceDispute(tx,meta(),doc.id,null));
  await run(f,tx=>reverseInvoicePayment(tx,meta(),p.id,'Returned check'));
  summary=await run(f,tx=>listRevenue(tx));expect(summary.direct).toBe('0');expect(summary.influenced).toBe('0');
 });
 it('keeps delivery-only influence separate and does not invent evidence for old or unanswered contacts',async()=>{
  const f=await fixture(),{doc}=await billed(f,{response:false});await run(f,tx=>recordInvoicePayment(tx,meta(),{invoiceId:doc.id,amountCents:doc.totalCents,method:'cash',reference:''}));
  const summary=await run(f,tx=>listRevenue(tx));expect(summary.direct).toBe('0');expect(summary.influenced).toBe('64000');
  const other=await fixture(),b=await billed(other,{response:false,delivery:false});await run(other,tx=>recordInvoicePayment(tx,meta(),{invoiceId:b.doc.id,amountCents:b.doc.totalCents,method:'cash',reference:''}));expect((await run(other,tx=>listRevenue(tx))).rows).toEqual([]);
 });
 it('validates tenant/customer provenance and protects attribution identity at the database',async()=>{
  const f=await fixture(),{doc,touch,source}=await billed(f),other=await fixture();
  await expect(run(other,tx=>createJob(tx,{sourceRecoveryItemId:source.id,sourceContactActivityId:touch.activityId,customerId:other.customerId,vehicleId:other.vehicleId,title:'Tampered',parts:[],labor:[]}))).rejects.toThrow();
  await expect(run(f,tx=>createJob(tx,{customerId:f.customerId,vehicleId:f.vehicleId,title:'Wrong recommendation',parts:[{description:'Bad',quantity:1,unitCostCents:0,unitPriceCents:100,recommendationId:other.recommendationId}],labor:[]}))).rejects.toThrow(/link/);
  await run(f,tx=>recordInvoicePayment(tx,meta(),{invoiceId:doc.id,amountCents:doc.totalCents,method:'cash',reference:''}));
  const [r]=await run(f,tx=>tx.select().from(revenueAttribution));expect(await run(other,tx=>tx.select().from(revenueAttribution))).toEqual([]);
  await expect(run(f,tx=>tx.insert(revenueAttribution).values({businessId:f.businessId,invoiceId:doc.id,ruleVersion:'manual-v1',decision:{}}))).rejects.toThrow();
  await expect(withTenant(f.businessId,f.staff!.actor,tx=>tx.update(revenueAttribution).set({excluded:true}).where(eq(revenueAttribution.id,r.id)))).rejects.toThrow();
  await expect(withTenant(f.businessId,{type:'support',id:null},tx=>reviewRevenue(tx,meta(),r.id,true,'Blocked'))).rejects.toThrow();
  const [version]=await run(f,tx=>tx.select().from(estimateVersion).where(eq(estimateVersion.id,doc.versionId)));
  await expect(run(f,tx=>tx.update(estimateVersion).set({sourceContactActivityId:touch.activityId}).where(eq(estimateVersion.id,version.id)))).rejects.toThrow();
  const mappings=await run(f,tx=>tx.select().from(estimateRecommendationLine));expect(mappings).toHaveLength(1);
  await expect(run(f,tx=>tx.delete(estimateRecommendationLine).where(eq(estimateRecommendationLine.id,mappings[0].id)))).rejects.toThrow();
  expect((await run(f,tx=>tx.select().from(activity).where(eq(activity.kind,'recovery.responded'))))[0].data).toMatchObject({ownerConfirmed:true,contactActivityId:touch.activityId});
 });
});
