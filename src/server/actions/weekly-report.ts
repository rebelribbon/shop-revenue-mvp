"use server";
import { z } from "zod";
import {
  prepareWeeklyNow,
  saveWeeklySettings,
  sendPreparedWeekly,
} from "@/domain/weekly-report";
import { defineShopAction } from "./define";

export const sendWeeklyNowAction = defineShopAction({
  name: "sendWeeklyReport",
  ownerOnly: true,
  input: z.object({}),
  run: ({ tx }) => prepareWeeklyNow(tx),
  persist: (p) => ({ weekStart: p.weekStart }),
  afterCommit: (p, session) =>
    sendPreparedWeekly(session.businessId, session.actor, p),
});

export const saveWeeklySettingsAction = defineShopAction({
  name: "saveWeeklySettings",
  ownerOnly: true,
  input: z.object({
    on: z.enum(["true", "false"]).transform((v) => v === "true"),
  }),
  run: async ({ tx, meta }, i) => {
    const r = await saveWeeklySettings(tx, meta, i);
    return {
      ...r,
      message: r.on
        ? "You’ll get the summary every Monday."
        : "Monday summary turned off.",
    };
  },
});
