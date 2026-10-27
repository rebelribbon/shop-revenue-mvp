"use server";
import {getSessionState} from "../auth/session";
import { z } from "zod";
import { freezeEstimate,revokeEstimate,signEstimate,rotateEstimateLink } from "@/domain/estimates";
import { defineShopAction } from "./define";
import { getRequestMeta } from "../request";
export const freezeEstimateAction=defineShopAction({name:"freezeEstimate",input:z.object({jobId:z.uuid(),expectedJobVersion:z.uuid(),taxBps:z.coerce.number().int().min(0).max(10000),supplementReason:z.string().max(2000),terms:z.string().max(5000)}),run:({tx,meta},i)=>freezeEstimate(tx,meta,i),persist:r=>({id:r.id,version:r.version})});
export const revokeEstimateAction=defineShopAction({name:"revokeEstimate",input:z.object({id:z.uuid()}),run:({tx,meta},i)=>revokeEstimate(tx,meta,i.id)});
export async function signEstimateAction(raw:unknown){
 const p=z.object({token:z.string().length(43),name:z.string().trim().min(1).max(200),ids:z.array(z.string().max(40)).max(200),consent:z.literal(true)}).safeParse(raw);
 if(!p.success)return {ok:false,message:"Enter your name and confirm the authorization statement."};
 try{const state=await getSessionState();if(state.kind==="shop"&&state.session.actor.type==="support")return {ok:false,message:"View-as is read-only."};await signEstimate(p.data.token,p.data.name,p.data.ids,await getRequestMeta());return {ok:true};}catch{return {ok:false,message:"This estimate is unavailable or already signed. Reload to check its status."};}
}

export const rotateEstimateLinkAction=defineShopAction({name:"rotateEstimateLink",input:z.object({id:z.uuid()}),run:({tx,meta},i)=>rotateEstimateLink(tx,meta,i.id),persist:r=>({id:r.id})});
