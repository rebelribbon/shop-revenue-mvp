"use server";
import { z } from "zod";
import { defineShopAction } from "./define";
import { addExpense, reverseExpense, expenseInput } from "@/domain/owner-money";
import {
  saveCommonJob,
  archiveCommonJob,
  commonJobInput,
} from "@/domain/common-jobs";
export const addExpenseAction = defineShopAction({
  name: "addExpense",
  ownerOnly: true,
  input: expenseInput
    .omit({ amountCents: true, includedInJobCost: true })
    .extend({
      amount: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/),
      includedInJobCost: z.enum(["true", "false"]),
    }),
  run: ({ tx, meta }, i) =>
    addExpense(tx, meta, {
      ...i,
      amountCents: Math.round(Number(i.amount) * 100),
      includedInJobCost: i.includedInJobCost === "true",
    }),
});
export const reverseExpenseAction = defineShopAction({
  name: "reverseExpense",
  ownerOnly: true,
  input: z.object({ id: z.uuid(), reason: z.string().min(1).max(1000) }),
  run: ({ tx, meta }, i) => reverseExpense(tx, meta, i.id, i.reason),
});
export const saveCommonJobAction = defineShopAction({
  name: "saveCommonJob",
  ownerOnly: true,
  input: z.object(commonJobInput.shape),
  run: ({ tx, meta }, i) => saveCommonJob(tx, meta, i),
});
export const archiveCommonJobAction = defineShopAction({
  name: "archiveCommonJob",
  ownerOnly: true,
  input: z.object({ id: z.uuid() }),
  run: ({ tx, meta }, i) => archiveCommonJob(tx, meta, i.id),
});
