"use server";
import { AppError } from "@/lib/errors";
import { decodeVin } from "@/providers/vin";
import { getSessionState } from "../auth/session";

export async function lookupVinAction(vin: string) {
  const state = await getSessionState();
  if (state.kind !== "shop") return { ok: false as const, message: "Please sign in again." };
  try {
    return { ok: true as const, data: await decodeVin(vin) };
  } catch (error) {
    const app = error instanceof AppError ? error : null;
    return { ok: false as const, message: app?.message ?? "VIN lookup failed. You can enter the vehicle manually." };
  }
}
