"use server";
import { z } from "zod";
import {
  prepareReminderNow,
  saveReminderSettings,
  sendPreparedReminder,
} from "@/domain/payment-reminders";
import { defineShopAction } from "./define";

export const sendReminderAction = defineShopAction({
  name: "sendPaymentReminder",
  input: z.object({ invoiceId: z.uuid() }),
  run: ({ tx, meta }, i) => prepareReminderNow(tx, meta, i.invoiceId),
  // The email body holds a live pay link: keep it out of the stored replay.
  persist: (p) => ({ invoiceId: p.invoiceId, to: p.email.to }),
  afterCommit: (p, session) =>
    sendPreparedReminder(session.businessId, session.actor, p),
});

export const saveReminderSettingsAction = defineShopAction({
  name: "saveReminderSettings",
  ownerOnly: true,
  input: z.object({
    on: z.enum(["true", "false"]).transform((v) => v === "true"),
    everyDays: z.coerce.number().int().min(1).max(30),
  }),
  run: async ({ tx, meta }, i) => {
    const r = await saveReminderSettings(tx, meta, i);
    return {
      ...r,
      message: r.on
        ? `Reminders on: every ${r.everyDays} day${r.everyDays === 1 ? "" : "s"} once an invoice is due.`
        : "Automatic reminders are off.",
    };
  },
});
