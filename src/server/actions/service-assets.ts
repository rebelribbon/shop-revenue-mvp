"use server";
import { z } from "zod";
import { serviceAssetInput, saveServiceAsset, archiveServiceAsset } from "@/domain/service-assets";
import { defineShopAction } from "./define";
export const saveServiceAssetAction = defineShopAction({name:"saveServiceAsset",input:serviceAssetInput,run:({tx,meta},input)=>saveServiceAsset(tx,meta,input)});
export const archiveServiceAssetAction = defineShopAction({name:"archiveServiceAsset",input:z.object({customerId:z.uuid(),assetId:z.uuid()}),run:({tx,meta},input)=>archiveServiceAsset(tx,meta,input.customerId,input.assetId)});
