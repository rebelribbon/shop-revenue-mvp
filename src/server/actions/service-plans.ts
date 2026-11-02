"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  billPlanVisits,
  setServicePlanStatus,
  startServicePlan,
} from "@/domain/service-plans";
import { formatPlanDate } from "@/lib/service-plans";
import { defineShopAction } from "./define";

const start = defineShopAction({
  name: "startServicePlan",
  input: z.object({ jobId: z.uuid() }),
  run: ({ tx, meta }, input) => startServicePlan(tx, meta, input),
  persist: (r) => ({
    id: r.id,
    message: `Service plan started. ${r.visitsScheduled} visit${r.visitsScheduled === 1 ? "" : "s"} added to your calendar${r.moved ? `; the signed start date had passed, so the first visit is ${formatPlanDate(r.firstVisit)}` : ""}.`,
  }),
});
export async function startServicePlanAction(input: unknown) {
  const r = await start(input);
  if (r.ok) revalidatePath("/app", "layout");
  return r;
}

export const setServicePlanStatusAction = defineShopAction({
  name: "setServicePlanStatus",
  ownerOnly: true,
  input: z.object({
    planId: z.uuid(),
    action: z.enum(["pause", "resume", "end"]),
    reason: z.string().max(300).optional(),
  }),
  run: ({ tx, meta }, input) => setServicePlanStatus(tx, meta, input),
  persist: (r) => ({
    id: r.id,
    message:
      r.status === "paused"
        ? "Plan paused. Upcoming visits were taken off the calendar."
        : r.status === "active"
          ? "Plan resumed. Upcoming visits are back on the calendar."
          : "Plan ended. Upcoming visits were taken off the calendar.",
  }),
});

export const billPlanNowAction = defineShopAction({
  name: "billPlanNow",
  input: z.object({ planId: z.uuid() }),
  run: async ({ tx, meta }, input) => {
    const r = await billPlanVisits(tx, meta, input.planId);
    return r
      ? { message: `Invoice #${r.number} created. Open Invoices to send it.` }
      : { message: "Nothing to bill: no finished visits waiting." };
  },
});
