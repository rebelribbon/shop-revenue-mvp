"use server";
import { z } from "zod";
import { serviceAssetInput, saveServiceAsset, archiveServiceAsset, setServiceAssetNextService } from "@/domain/service-assets";
import { defineShopAction } from "./define";
export const saveServiceAssetAction = defineShopAction({name:"saveServiceAsset",input:serviceAssetInput,run:({tx,meta},input)=>saveServiceAsset(tx,meta,input)});
export const archiveServiceAssetAction = defineShopAction({name:"archiveServiceAsset",input:z.object({customerId:z.uuid(),assetId:z.uuid()}),run:({tx,meta},input)=>archiveServiceAsset(tx,meta,input.customerId,input.assetId)});

export const setServiceAssetNextServiceAction = defineShopAction({
  name:"setServiceAssetNextService",
  input:z.object({customerId:z.uuid(),assetId:z.uuid(),on:z.iso.date().or(z.literal("")),description:z.string().max(200).optional(),amount:z.string().regex(/^(\d{1,6}(\.\d{1,2})?)?$/,"Enter dollars with up to two decimal places.").optional()}),
  run:({tx,meta},input)=>setServiceAssetNextService(tx,meta,{customerId:input.customerId,assetId:input.assetId,on:input.on||null,description:input.description||null,amountCents:input.amount?Math.round(Number(input.amount)*100):null}),
  persist:r=>({...r,message:"Next service updated. No message was sent."}),
});
