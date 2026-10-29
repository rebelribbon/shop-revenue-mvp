import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { activity, appointment, estimateAuthorization, estimateVersion, invoice, invoicePayment, recommendation, recoveryItem, vehicle } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { createCustomer, createVehicle } from "@/domain/customers";
import { createJob } from "@/domain/jobs";
import { createAppointment } from "@/domain/appointments";
import { setInvoiceDispute } from "@/domain/invoices";
import { freezeEstimate, signEstimate } from "@/domain/estimates";
import { startRecoveryWork, getMoneyFinder, setDoNotContact, setNextService, updateRecovery } from "@/domain/money-finder";
import { localDateKey, addLocalDays } from "@/lib/timezone";
import { newToken } from "@/lib/tokens";
import { meta, seedTenant } from "../helpers/fixtures";

const now=new Date(Date.now()+60000);
const daysAgo=(n:number)=>new Date(now.getTime()-n*86400000);
const today=localDateKey(now,'America/Chicago');
let sequence=1000;
async function fixture() {
  const t=await seedTenant('Money',{withStaff:true});
  const c=await withTenant(t.businessId,t.owner.actor,tx=>createCustomer(tx,meta(),{firstName:'Real',lastName:'History',phoneE164:'+15125550123'}));
  const v=await withTenant(t.businessId,t.owner.actor,tx=>createVehicle(tx,meta(),{customerId:c.id,make:'Honda',model:'Civic'}));
  return {...t,customerId:c.id,vehicleId:v.id};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
const run=<T>(f:Fixture,fn:Parameters<typeof withTenant<T>>[2])=>withTenant(f.businessId,f.owner.actor,fn);
const dashboard=(f:Fixture,options:Parameters<typeof getMoneyFinder>[1]={})=>run(f,tx=>getMoneyFinder(tx,{now,...options}));
async function estimate(f:Fixture,age=3,expires=30,approved?:string[]) {
  const token=newToken();
  const e=await run(f,async tx=>(await tx.insert(estimateVersion).values({businessId:f.businessId,customerId:f.customerId,vehicleId:f.vehicleId,quoteId:randomUUID(),version:1,
    tokenHash:token.hash,createdAt:daysAgo(age),expiresAt:daysAgo(-expires),
    snapshot:{title:'Brake repair',shopName:'Shop',customerName:'Real History',vehicleLabel:'Honda Civic',
      lines:[{id:'part-0',description:'Front brakes',kind:'part',quantity:1,unitPriceCents:4000,totalCents:4000},{id:'labor-0',description:'Brake labor',kind:'labor',quantity:1,unitPriceCents:6000,totalCents:6000}],
      subtotalCents:10000,taxBps:0,taxCents:0,totalCents:10000,terms:''}}).returning())[0]);
  if(approved) await signEstimate(token.token,'Customer',approved,meta());
  return e;
}
async function bill(f:Fixture,age:number,paid:number,paidAge=age) {
  const e=await estimate(f,age,30,['part-0','labor-0']);
  return run(f,async tx=>{
    const [auth]=await tx.select().from(estimateAuthorization).where(eq(estimateAuthorization.versionId,e.id));
    const [i]=await tx.insert(invoice).values({businessId:f.businessId,number:++sequence,customerId:f.customerId,vehicleId:f.vehicleId,
      quoteId:e.quoteId,versionId:e.id,authorizationId:auth.id,snapshot:e.snapshot,totalCents:10000,createdAt:daysAgo(age),tokenHash:newToken().hash,expiresAt:daysAgo(-90)}).returning();
    if(paid) await tx.insert(invoicePayment).values({businessId:f.businessId,invoiceId:i.id,amountCents:paid,method:'cash',createdAt:daysAgo(paidAge)});
    return i;
  });
}

describe('Money Finder live list rules',()=>{
  it('keeps the live dashboard bounded at 20,000 customers',async()=>{
    const f=await fixture();
    await run(f,tx=>tx.execute(sql`INSERT INTO app.customer(business_id,first_name,display_name) SELECT ${f.businessId},'Scale','Scale '||n FROM generate_series(1,19999) n`));
    await estimate(f,3,30,[]);
    await dashboard(f);
    const times:number[]=[];
    for(let i=0;i<5;i++) await run(f,async tx=>{const started=performance.now();const data=await getMoneyFinder(tx,{now});times.push(performance.now()-started);expect(data.total).toBe(1);});
    times.sort((a,b)=>a-b);
    console.info(`Money Finder 20,000 customers: median ${times[2].toFixed(1)}ms; max ${times[4].toFixed(1)}ms`);
    expect(times[2]).toBeLessThan(300);
  });

  it('retains the source when starting work and rejects substituted tenants or customers',async()=>{
    const f=await fixture();await estimate(f,3,30,[]);
    const source=await run(f,tx=>startRecoveryWork(tx,meta(),{category:'declined',subjectId:f.vehicleId,destination:'job'}));
    expect(source.redirectTo).toContain(`sourceRecoveryItemId=${source.id}`);
    const input={sourceRecoveryItemId:source.id,customerId:f.customerId,vehicleId:f.vehicleId,title:'Re-quote',parts:[{description:'Brakes',quantity:1,unitCostCents:1000,unitPriceCents:2000}],labor:[]};
    const job=await run(f,tx=>createJob(tx,input));
    const [costed]=await run(f,tx=>tx.select().from(activity).where(eq(activity.subjectId,job.id)));
    const frozen=await run(f,tx=>freezeEstimate(tx,meta(),{jobId:job.id,expectedJobVersion:costed.id,taxBps:0,supplementReason:'',terms:''}));
    const [published]=await run(f,tx=>tx.select().from(estimateVersion).where(eq(estimateVersion.id,frozen.id)));
    expect(published.sourceRecoveryItemId).toBe(source.id);
    const a=await run(f,tx=>createAppointment(tx,meta(),{customerId:f.customerId,vehicleId:f.vehicleId,sourceRecoveryItemId:source.id,localStartsAt:'2026-11-10T10:00'}));
    expect(a.sourceRecoveryItemId).toBe(source.id);
    const other=await fixture();
    await expect(run(other,tx=>createJob(tx,{...input,customerId:other.customerId,vehicleId:other.vehicleId}))).rejects.toThrow(/opportunity/);
  });

  it('captures signed declines, groups by vehicle, and never invents unknown prices',async()=>{
    const f=await fixture();
    await estimate(f,3,30,['part-0']);
    let data=await dashboard(f);
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({category:'declined',amountCents:6000});
    await run(f,tx=>tx.insert(recommendation).values({businessId:f.businessId,customerId:f.customerId,vehicleId:f.vehicleId,description:'Unknown price',declinedAt:daysAgo(1)}));
    data=await dashboard(f);
    expect(data.items).toHaveLength(1);expect(data.items[0].amountCents).toBeNull();
    expect(data.cards[0]).toMatchObject({category:'declined',count:1,unknownCount:1});
    expect(data.knownCents).toBe(0);
  });
  it('waits two days for open estimates, flags expired estimates, and drops old/revoked versions',async()=>{
    const f=await fixture();
    await estimate(f,1);const eligible=await estimate(f,2);const expired=await estimate(f,70,-59);
    await estimate(f,80,-61);const revoked=await estimate(f,4);
    await run(f,tx=>tx.update(estimateVersion).set({revokedAt:new Date()}).where(eq(estimateVersion.id,revoked.id)));
    const data=await dashboard(f,{category:'open_estimate'});
    expect(data.items.map(i=>i.subjectId).sort()).toEqual([eligible.id,expired.id].sort());
    expect(data.items.find(i=>i.subjectId===expired.id)?.renewFirst).toBe(true);
  });
  it('shows invoice balances after three days, including manual deposits, and excludes paid invoices',async()=>{
    const f=await fixture();
    const due=await bill(f,3,2500);await bill(f,2,0);await bill(f,5,10000);
    const data=await dashboard(f,{category:'unpaid_invoice'});
    expect(data.items).toHaveLength(1);expect(data.items[0]).toMatchObject({subjectId:due.id,amountCents:7500});
    await run(f,tx=>setInvoiceDispute(tx,meta(),due.id,'Customer contests the balance'));
    expect((await dashboard(f,{category:'unpaid_invoice'})).items).toEqual([]);
    await run(f,tx=>setInvoiceDispute(tx,meta(),due.id,null));
    expect((await dashboard(f,{category:'unpaid_invoice'})).items[0].amountCents).toBe(7500);
  });
  it('requires a real paid visit for lapsed customers and keeps estimates outside known dollars',async()=>{
    const f=await fixture();await bill(f,220,10000);
    const data=await dashboard(f,{category:'lapsed'});
    expect(data.items).toHaveLength(1);expect(data.items[0].amountCents).toBe(10000);expect(data.knownCents).toBe(0);
    const empty=await fixture();expect((await dashboard(empty)).items).toEqual([]);
    await run(f,tx=>tx.insert(appointment).values({businessId:f.businessId,customerId:f.customerId,startsAt:daysAgo(-1)}));
    expect((await dashboard(f,{category:'lapsed'})).items).toEqual([]);
  });
  it('prioritizes specific outstanding work over a lapsed-customer alert',async()=>{
    const f=await fixture();await bill(f,220,10000);await estimate(f,3);
    const data=await dashboard(f);
    expect(data.items.map(i=>i.category)).toEqual(['open_estimate']);
  });
  it('uses entered service dates, allows unknown value, and excludes future appointments and recently paid service',async()=>{
    const f=await fixture();
    const service=(on:string)=>run(f,tx=>setNextService(tx,meta(),{customerId:f.customerId,vehicleId:f.vehicleId,on,description:'Oil service',amountCents:null}));
    await service(addLocalDays(today,14));
    expect((await dashboard(f,{category:'service_due'})).items[0].amountCents).toBeNull();
    await service(addLocalDays(today,15));expect((await dashboard(f,{category:'service_due'})).items).toEqual([]);
    await service(addLocalDays(today,-91));expect((await dashboard(f,{category:'service_due'})).items).toEqual([]);
    await service(today);await bill(f,10,10000);
    expect((await dashboard(f,{category:'service_due'})).items).toEqual([]);
    const other=await fixture();await run(other,tx=>setNextService(tx,meta(),{customerId:other.customerId,vehicleId:other.vehicleId,on:today,description:'Service',amountCents:5000}));
    await run(other,tx=>tx.insert(appointment).values({businessId:other.businessId,customerId:other.customerId,vehicleId:other.vehicleId,startsAt:daysAgo(-1)}));
    expect((await dashboard(other,{category:'service_due'})).items).toEqual([]);
  });
  it('snoozes and restores without duplicate workflow records, dismisses only the grouped open recommendations',async()=>{
    const f=await fixture();await estimate(f,3,30,[]);
    const input={category:'declined' as const,subjectId:f.vehicleId};
    await run(f,tx=>updateRecovery(tx,meta(),{...input,action:'snooze',days:30}));
    expect((await dashboard(f)).items).toEqual([]);
    expect((await dashboard(f,{view:'snoozed'})).items).toHaveLength(1);
    expect((await dashboard(f,{now:daysAgo(-31)})).items).toHaveLength(1);
    await run(f,tx=>updateRecovery(tx,meta(),{...input,action:'restore'}));
    await run(f,tx=>updateRecovery(tx,meta(),{...input,action:'dismiss',reason:'Work completed elsewhere'}));
    expect((await dashboard(f)).items).toEqual([]);
    expect((await dashboard(f,{view:'dismissed'})).items).toHaveLength(1);
    await run(f,tx=>updateRecovery(tx,meta(),{...input,action:'restore'}));
    expect((await dashboard(f)).items[0].amountCents).toBe(10000);
    expect(await run(f,tx=>tx.select().from(recoveryItem))).toHaveLength(1);
  });
  it('excludes do-not-contact and archived vehicles; other tenants and support cannot mutate records',async()=>{
    const f=await fixture();await estimate(f,3,30,[]);
    const other=await fixture();
    await expect(run(other,tx=>updateRecovery(tx,meta(),{category:'declined',subjectId:f.vehicleId,action:'contact',method:'phone'}))).rejects.toThrow();
    expect((await dashboard(other)).items).toEqual([]);
    await expect(withTenant(f.businessId,{type:'support',id:null},tx=>setDoNotContact(tx,meta(),f.customerId,true))).rejects.toThrow();
    await run(f,tx=>setDoNotContact(tx,meta(),f.customerId,true));expect((await dashboard(f)).items).toEqual([]);
    await run(f,tx=>setDoNotContact(tx,meta(),f.customerId,false));
    await run(f,tx=>tx.update(vehicle).set({status:'archived'}).where(eq(vehicle.id,f.vehicleId)));
    expect((await dashboard(f)).items).toEqual([]);
  });
  it('records manual contact once per state identity, validates methods, and never marks money recovered',async()=>{
    const f=await fixture();await estimate(f,3,30,[]);
    await withTenant(f.businessId,f.staff!.actor,tx=>updateRecovery(tx,meta(),{category:'declined',subjectId:f.vehicleId,action:'contact',method:'phone',note:'Left voicemail'}));
    const data=await dashboard(f);expect(data.items[0]).toMatchObject({status:'contacted',lastContactMethod:'phone',amountCents:10000});
    expect(data.items[0].lastContactAt).toBeTruthy();expect(data.knownCents).toBe(10000);
    await expect(run(f,tx=>updateRecovery(tx,meta(),{category:'declined',subjectId:f.vehicleId,action:'contact',method:'email'}))).rejects.toThrow(/method/);
  });
});
