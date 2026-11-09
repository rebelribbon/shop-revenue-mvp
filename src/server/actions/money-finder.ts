"use server";
import { z } from "zod";
import { defineShopAction } from "./define";
import {
  addRecommendation,
  startRecoveryWork,
  moneyCategories,
  setDoNotContact,
  setNextService,
  setRecommendationStatus,
  updateRecovery,
} from "@/domain/money-finder";
const dollars = z
  .string()
  .regex(
    /^(\d{1,6}(\.\d{1,2})?)?$/,
    "Enter dollars with up to two decimal places.",
  )
  .optional();
const cents = (s?: string) => (s ? Math.round(Number(s) * 100) : null);
export const updateRecoveryAction = defineShopAction({
  name: "updateRecovery",
  input: z.object({
    category: z.enum(moneyCategories),
    subjectId: z.uuid(),
    action: z.enum([
      "contact",
      "responded",
      "booked",
      "snooze",
      "dismiss",
      "restore",
    ]),
    deliveryConfirmed: z.enum(["true", "false"]).optional(),
    method: z.enum(["phone", "email", "in_person", "other"]).optional(),
    callOutcome: z.enum(["reached", "no_answer"]).optional(),
    note: z.string().max(1000).optional(),
    days: z.enum(["1", "7", "30", "90"]).optional(),
    reason: z.string().max(1000).optional(),
  }),
  run: ({ tx, meta }, input) =>
    updateRecovery(tx, meta, {
      ...input,
      deliveryConfirmed: input.deliveryConfirmed === "true",
      days: input.days ? (Number(input.days) as 1 | 7 | 30 | 90) : undefined,
    }),
  persist: (r) => ({
    ...r,
    message: "Follow-up updated. No message was sent.",
  }),
});
export const addRecommendationAction = defineShopAction({
  name: "addRecommendation",
  input: z.object({
    customerId: z.uuid(),
    vehicleId: z.uuid(),
    description: z.string().min(1).max(500),
    amount: dollars,
    declinedOn: z.iso.date(),
  }),
  run: ({ tx, meta }, input) =>
    addRecommendation(tx, meta, {
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      description: input.description,
      amountCents: cents(input.amount),
      declinedOn: input.declinedOn,
    }),
  persist: (r) => ({ ...r, message: "Declined work recorded." }),
});
export const setRecommendationStatusAction = defineShopAction({
  name: "setRecommendationStatus",
  input: z.object({
    id: z.uuid(),
    status: z.enum(["open", "quoted", "won", "lost"]),
  }),
  run: ({ tx, meta }, input) =>
    setRecommendationStatus(tx, meta, input.id, input.status),
  persist: (r) => ({ ...r, message: "Recommendation updated." }),
});
export const setNextServiceAction = defineShopAction({
  name: "setNextService",
  input: z.object({
    customerId: z.uuid(),
    vehicleId: z.uuid(),
    on: z.iso.date().or(z.literal("")),
    description: z.string().max(200).optional(),
    amount: dollars,
  }),
  run: ({ tx, meta }, input) =>
    setNextService(tx, meta, {
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      on: input.on || null,
      description: input.description || null,
      amountCents: cents(input.amount),
    }),
  persist: (r) => ({ ...r, message: "Next service updated." }),
});
export const setDoNotContactAction = defineShopAction({
  name: "setDoNotContact",
  // Opt-outs must be honored even when the subscription lapses.
  allowWhenUnpaid: true,
  input: z.object({ customerId: z.uuid(), value: z.enum(["true", "false"]) }),
  run: ({ tx, meta }, input) =>
    setDoNotContact(tx, meta, input.customerId, input.value === "true"),
  persist: (r) => ({ ...r, message: "Contact preference updated." }),
});

export const startRecoveryWorkAction = defineShopAction({
  name: "startRecoveryWork",
  input: z.object({
    category: z.enum(moneyCategories),
    subjectId: z.uuid(),
    destination: z.enum(["job", "appointment"]),
  }),
  run: ({ tx, meta }, input) => startRecoveryWork(tx, meta, input),
  persist: (r) => r,
});
