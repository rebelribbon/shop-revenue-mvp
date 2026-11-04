"use server";
import { z } from "zod";
import { saveDepositSettings, startDeposit } from "@/domain/deposits";
import { defineShopAction } from "./define";

export const startDepositAction = defineShopAction({
  name: "startDeposit",
  input: z.object({ jobId: z.uuid() }),
  run: async ({ tx, meta }, i) => {
    const r = await startDeposit(tx, meta, i.jobId);
    return {
      ...r,
      redirectTo: `/app/checkout?invoiceId=${r.invoiceId}&amount=${r.depositCents}`,
    };
  },
});

// Form fields: dollars for the threshold, whole percent.
export const saveDepositSettingsAction = defineShopAction({
  name: "saveDepositSettings",
  ownerOnly: true,
  input: z.object({
    on: z.enum(["true", "false"]).transform((v) => v === "true"),
    over: z.coerce.number().min(0).max(1_000_000),
    percent: z.coerce.number().int().min(5).max(100),
  }),
  run: async ({ tx, meta }, i) => {
    const r = await saveDepositSettings(tx, meta, {
      on: i.on,
      overCents: Math.round(i.over * 100),
      percent: i.percent,
    });
    return {
      ...r,
      message: r.on
        ? `Deposits on: ${r.percent}% on approved work of $${(r.overCents / 100).toLocaleString("en-US")} or more.`
        : "Deposits are off.",
    };
  },
});
