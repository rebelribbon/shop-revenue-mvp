"use server";
import { z } from "zod";
import { defineShopAction } from "./define";
import { reconcileRevenue, reviewRevenue } from "@/domain/revenue";
export const refreshRevenueAction = defineShopAction({
  name: "refreshRevenue",
  input: z.object({}),
  run: ({ tx, meta }) =>
    reconcileRevenue(tx, meta, "Shop requested evidence reconciliation"),
  persist: (r) => ({
    ...r,
    message: "Recorded evidence checked. No money was moved.",
  }),
});
export const reviewRevenueAction = defineShopAction({
  name: "reviewRevenue",
  ownerOnly: true,
  input: z.object({
    id: z.uuid(),
    excluded: z.enum(["true", "false"]),
    reason: z.string().trim().min(1).max(900),
  }),
  run: ({ tx, meta }, i) =>
    reviewRevenue(tx, meta, i.id, i.excluded === "true", i.reason),
  persist: (r) => ({
    ...r,
    message: "Attribution corrected; history retained.",
  }),
});
