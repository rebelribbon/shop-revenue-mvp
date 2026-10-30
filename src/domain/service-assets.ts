import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { asset } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError, notFound } from "@/lib/errors";
import { getCustomerWithVehicles } from "./customers";
import { audit, recordActivity, type RequestMeta } from "./records";

const short = z.string().trim().max(200).default("");
export const serviceAssetInput = z.object({
  customerId: z.uuid(), assetId: z.uuid().optional(), type: z.enum(["property", "equipment"]),
  displayName: z.string().trim().min(1).max(200), parentAssetId: z.union([z.uuid(), z.literal("")]).optional(),
  addressLine1: short, addressLine2: short, city: short, region: short, postalCode: short,
  manufacturer: short, model: short, serialNumber: short, installedOn: z.union([z.iso.date(),z.literal("")]).default(""),
  notes: z.string().trim().max(5000).default(""),
});
export type ServiceAssetInput = z.infer<typeof serviceAssetInput>;
export async function listServiceAssets(tx: TenantTx, customerId?: string) {
  return tx.select().from(asset).where(and(eq(asset.businessId, tx.businessId), eq(asset.status, "active"),
    inArray(asset.type, ["property", "equipment"]), customerId ? eq(asset.customerId, customerId) : undefined)).orderBy(desc(asset.updatedAt));
}
export async function getServiceAsset(tx: TenantTx, customerId: string, id: string) {
  const [row] = await tx.select().from(asset).where(and(eq(asset.businessId,tx.businessId),eq(asset.customerId,customerId),eq(asset.id,id),eq(asset.status,"active"),inArray(asset.type,["property","equipment"])));
  if (!row) throw notFound("That property or equipment");
  return row;
}
export async function serviceAssetLabel(tx: TenantTx, customerId: string, id: string) {
  const row = await getServiceAsset(tx,customerId,id);
  const property = row.parentAssetId ? await getServiceAsset(tx,customerId,row.parentAssetId) : row;
  return [row.displayName, property === row ? null : property.displayName, ...["addressLine1","addressLine2","city","region","postalCode"].map(k=>property.details[k])].filter(Boolean).join(", ");
}
export async function saveServiceAsset(tx: TenantTx, meta: RequestMeta, input: ServiceAssetInput) {
  const d = serviceAssetInput.parse(input);
  await getCustomerWithVehicles(tx,d.customerId);
  if (d.type === "property" && !d.addressLine1.trim()) throw new AppError("VALIDATION","A property needs a street address.");
  const before = d.assetId ? await getServiceAsset(tx,d.customerId,d.assetId) : null;
  if (before && before.type !== d.type) throw new AppError("VALIDATION","The asset type cannot be changed.");
  if (d.parentAssetId) {
    const parent = await getServiceAsset(tx,d.customerId,d.parentAssetId);
    if (d.type !== "equipment" || parent.type !== "property") throw new AppError("VALIDATION","Equipment must belong to a property.");
  }
  const { customerId, assetId, type, displayName, parentAssetId, ...details } = d;
  const values = {displayName,details,parentAssetId:parentAssetId||null};
  const [row] = assetId
    ? await tx.update(asset).set(values).where(and(eq(asset.businessId,tx.businessId),eq(asset.customerId,customerId),eq(asset.id,assetId))).returning()
    : await tx.insert(asset).values({...values,businessId:tx.businessId,createdByUserId:tx.actor.id,customerId,type}).returning();
  await audit(tx,meta,{action:before?"asset.updated":"asset.created",targetType:"asset",targetId:row.id,after:{type,displayName}});
  await recordActivity(tx,{kind:before?"asset.updated":"asset.created",subjectType:"customer",subjectId:customerId,summary:`${type === "property" ? "Property" : "Equipment"} ${before?"updated":"added"}: ${displayName}`});
  return {id:row.id};
}
export async function archiveServiceAsset(tx: TenantTx, meta: RequestMeta, customerId: string, id: string) {
  const row = await getServiceAsset(tx,customerId,id);
  await tx.update(asset).set({status:"inactive"}).where(and(eq(asset.businessId,tx.businessId),eq(asset.customerId,customerId),eq(asset.id,id)));
  if(row.type === "property") await tx.update(asset).set({status:"inactive"}).where(and(eq(asset.businessId,tx.businessId),eq(asset.customerId,customerId),eq(asset.parentAssetId,id)));
  await audit(tx,meta,{action:"asset.archived",targetType:"asset",targetId:id});
  await recordActivity(tx,{kind:"asset.archived",subjectType:"customer",subjectId:customerId,summary:`Archived: ${row.displayName}`});
  return {id};
}


export const servicePlanInput = z.object({
  customerId:z.uuid(), assetId:z.uuid(), on:z.iso.date().nullable(),
  description:z.string().trim().max(200).nullable(), amountCents:z.number().int().min(0).max(99999999).nullable(),
});
export async function setServiceAssetNextService(tx:TenantTx, meta:RequestMeta, input:z.infer<typeof servicePlanInput>) {
  const d=servicePlanInput.parse(input);
  const before=await getServiceAsset(tx,d.customerId,d.assetId);
  const values={nextServiceOn:d.on,nextServiceDescription:d.on?(d.description||null):null,nextServiceAmountCents:d.on?d.amountCents:null};
  await tx.update(asset).set(values).where(and(eq(asset.businessId,tx.businessId),eq(asset.customerId,d.customerId),eq(asset.id,d.assetId)));
  await audit(tx,meta,{action:"asset.service_planned",targetType:"asset",targetId:d.assetId,before:{on:before.nextServiceOn,description:before.nextServiceDescription,amountCents:before.nextServiceAmountCents},after:values});
  await recordActivity(tx,{kind:"asset.service_planned",subjectType:"customer",subjectId:d.customerId,summary:d.on?`${before.displayName}: ${d.description||"Service"} due ${d.on}`:`Next service cleared: ${before.displayName}`});
  return {id:d.assetId};
}
