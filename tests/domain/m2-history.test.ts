import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { assetReading, note, vinDecodeCache } from "@/db/schema";
import { createCustomer, createVehicle, listCustomerTimeline, updateVehicle } from "@/domain/customers";
import { addNote, cacheVin, cachedVin, changeNote, listNotes, listReadings, recordMileage } from "@/domain/memory";
import { meta, seedTenant, type SeededTenant } from "../helpers/fixtures";
let a:SeededTenant,b:SeededTenant;
beforeAll(async()=>{a=await seedTenant("History");b=await seedTenant("Isolated");});
describe("M2 durable memory",()=>{
  it("preserves every odometer reading, including corrections, and rejects mutation",async()=>{
    const c=await withTenant(a.businessId,a.owner.actor,tx=>createCustomer(tx,meta(),{firstName:"Reading",lastName:"Owner"}));
    const v=await withTenant(a.businessId,a.owner.actor,tx=>createVehicle(tx,meta(),{customerId:c.id,mileage:12000}));
    await withTenant(a.businessId,a.owner.actor,tx=>updateVehicle(tx,meta(),v.id,{customerId:c.id,mileage:12500}));
    await withTenant(a.businessId,a.owner.actor,tx=>recordMileage(tx,c.id,v.id,12400));
    await withTenant(a.businessId,a.owner.actor,tx=>recordMileage(tx,c.id,v.id,12400));
    const readings=await withTenant(a.businessId,a.owner.actor,tx=>listReadings(tx,v.id));
    expect(readings.map(r=>r.value)).toEqual([12400,12400,12500,12000]);
    expect(await withTenant(b.businessId,b.owner.actor,tx=>listReadings(tx,v.id))).toEqual([]);
    await expect(withTenant(b.businessId,b.owner.actor,tx=>recordMileage(tx,c.id,v.id,1))).rejects.toThrow();
    await expect(withTenant(a.businessId,a.owner.actor,tx=>tx.update(assetReading).set({value:1}).where(eq(assetReading.id,readings[0].id)))).rejects.toThrow();
    await expect(withTenant(a.businessId,a.owner.actor,tx=>tx.delete(assetReading).where(eq(assetReading.id,readings[0].id)))).rejects.toThrow();
    await expect(withTenant(b.businessId,b.owner.actor,tx=>tx.insert(assetReading).values({businessId:b.businessId,assetId:v.id,value:1}))).rejects.toThrow();
  });
  it("retains note revisions, soft deletes, rejects stale edits and foreign subjects",async()=>{
    const c=await withTenant(a.businessId,a.owner.actor,tx=>createCustomer(tx,meta(),{firstName:"Note",lastName:"Owner"}));
    const added=await withTenant(a.businessId,a.owner.actor,tx=>addNote(tx,c.id,null,"First inspection"));
    const [original]=await withTenant(a.businessId,a.owner.actor,tx=>listNotes(tx,c.id));
    await withTenant(a.businessId,a.owner.actor,tx=>changeNote(tx,c.id,added.id,"Revised inspection",original.updatedAt.toISOString()));
    await expect(withTenant(a.businessId,a.owner.actor,tx=>changeNote(tx,c.id,added.id,"Stale edit",original.updatedAt.toISOString()))).rejects.toThrow(/changed/);
    const [updated]=await withTenant(a.businessId,a.owner.actor,tx=>listNotes(tx,c.id));
    await withTenant(a.businessId,a.owner.actor,tx=>changeNote(tx,c.id,added.id,null,updated.updatedAt.toISOString()));
    expect(await withTenant(a.businessId,a.owner.actor,tx=>listNotes(tx,c.id))).toEqual([]);
    const history=await withTenant(a.businessId,a.owner.actor,tx=>listCustomerTimeline(tx,c.id));
    expect(history.find(h=>h.kind==="note.updated")?.data).toMatchObject({before:"First inspection",after:"Revised inspection"});
    expect(history.find(h=>h.kind==="note.deleted")?.data).toMatchObject({before:"Revised inspection",after:null});
    expect(await withTenant(b.businessId,b.owner.actor,tx=>listNotes(tx,c.id))).toEqual([]);
    await expect(withTenant(b.businessId,b.owner.actor,tx=>addNote(tx,c.id,null,"Intruder"))).rejects.toThrow();
    await expect(withTenant(b.businessId,b.owner.actor,tx=>tx.insert(note).values({businessId:b.businessId,customerId:c.id,body:"Intruder"}))).rejects.toThrow();
  });
  it("reuses public VIN data for 180 days then expires it",async()=>{
    const vin="1HGCM82633A004352";
    const payload={year:2003,make:"HONDA",model:"Accord",trim:null};
    await withTenant(a.businessId,a.owner.actor,tx=>cacheVin(tx,vin,payload));
    expect(await withTenant(b.businessId,b.owner.actor,tx=>cachedVin(tx,vin))).toEqual(payload);
    await withTenant(a.businessId,a.owner.actor,tx=>tx.update(vinDecodeCache).set({decodedAt:sql`now()-interval '181 days'`}).where(eq(vinDecodeCache.vin,vin)));
    expect(await withTenant(a.businessId,a.owner.actor,tx=>cachedVin(tx,vin))).toBeNull();
  });
});
