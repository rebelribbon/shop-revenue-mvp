"use server";
import { z } from "zod";
import { closeRegister } from "@/domain/register";
import { defineShopAction } from "./define";

const dollars = z
  .string()
  .regex(/^\d{1,7}(\.\d{1,2})?$/, "Enter dollars, like 200 or 200.00.");

export const closeRegisterAction = defineShopAction({
  name: "closeRegister",
  input: z.object({
    day: z.iso.date(),
    starting: dollars,
    counted: dollars,
    note: z.string().max(1000).optional(),
  }),
  run: ({ tx, meta }, i) =>
    closeRegister(tx, meta, {
      day: i.day,
      startingCashCents: Math.round(Number(i.starting) * 100),
      countedCashCents: Math.round(Number(i.counted) * 100),
      note: i.note,
    }),
  persist: (r) => ({
    ...r,
    message:
      r.differenceCents === 0
        ? "Day closed. The drawer matches."
        : `Day closed. The drawer is ${r.differenceCents > 0 ? "over" : "short"} by $${(Math.abs(r.differenceCents) / 100).toFixed(2)}.`,
  }),
});
