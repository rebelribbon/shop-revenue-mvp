"use server";
import { z } from "zod";
import { setTargetMargin, startClock, stopClock } from "@/domain/job-profit";
import { defineShopAction } from "./define";

export const startClockAction = defineShopAction({
  name: "startClock",
  input: z.object({ jobId: z.uuid() }),
  run: ({ tx, meta }, i) => startClock(tx, meta, i.jobId),
  persist: (r) => ({ ...r, message: "Clock started." }),
});

export const stopClockAction = defineShopAction({
  name: "stopClock",
  input: z.object({}),
  run: ({ tx, meta }) => stopClock(tx, meta),
  persist: (r) => ({ ...r, message: "Clock stopped." }),
});

export const setTargetMarginAction = defineShopAction({
  name: "setTargetMargin",
  ownerOnly: true,
  input: z.object({ percent: z.coerce.number().min(0).max(95) }),
  run: ({ tx, meta }, i) => setTargetMargin(tx, meta, i.percent),
  persist: (r) => ({ ...r, message: "Target profit saved." }),
});
