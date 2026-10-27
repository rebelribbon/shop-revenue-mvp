"use server";
import { withTenant } from "@/db/tenant";
import { cachedVin, cacheVin } from "@/domain/memory";
import { AppError } from "@/lib/errors";
import { decodeVin } from "@/providers/vin";
import { getSessionState } from "../auth/session";

export async function lookupVinAction(vin: string) {
  const state = await getSessionState();
  if (state.kind !== "shop") return { ok: false as const, message: "Please sign in again." };
  try {
    vin = vin.replace(/\s/g, "").toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw new AppError("VALIDATION", "Enter a valid 17-character VIN.");
    const s=state.session;
    const cached=await withTenant(s.businessId,s.actor,tx=>cachedVin(tx,vin));
    if(cached) return {ok:true as const,data:cached};
    const data=await decodeVin(vin);
    if(s.actor.type!=="support") await withTenant(s.businessId,s.actor,tx=>cacheVin(tx,vin,data));
    return {ok:true as const,data};
  } catch (error) {
    const app = error instanceof AppError ? error : null;
    return { ok: false as const, message: app?.message ?? "VIN lookup failed. You can enter the vehicle manually." };
  }
}

