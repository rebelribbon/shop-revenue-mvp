"use server";
import { z } from "zod";
import {
  setInvoiceDispute,
  issueInvoice,
  recordInvoicePayment,
  reverseInvoicePayment,
  rotateInvoiceLink,
  voidInvoice,
} from "@/domain/invoices";
import { prepareReceipt, sendReceipt } from "@/domain/receipts";
import { defineShopAction } from "./define";
export const issueInvoiceAction = defineShopAction({
  name: "issueInvoice",
  input: z.object({
    versionId: z.uuid(),
    dueOn: z.union([z.iso.date(), z.literal("")]),
    terms: z.string().max(5000),
  }),
  run: ({ tx, meta }, i) =>
    issueInvoice(tx, meta, { ...i, dueOn: i.dueOn || null }),
  persist: (r) => ({ id: r.id }),
});
export const recordInvoicePaymentAction = defineShopAction({
  name: "recordInvoicePayment",
  input: z.object({
    invoiceId: z.uuid(),
    amountCents: z.coerce
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER),
    method: z.enum(["cash", "check", "external_card", "bank_transfer"]),
    reference: z.string().max(500),
  }),
  run: async ({ tx, meta }, i) => {
    const r = await recordInvoicePayment(tx, meta, i);
    // The customer's receipt is emailed after this commits.
    return { ...r, receipt: await prepareReceipt(tx, r.id) };
  },
  persist: (r) => ({ ...r, receipt: null }),
  afterCommit: async ({ receipt, ...r }) => {
    const sent = await sendReceipt(receipt);
    return {
      ...r,
      message: sent
        ? "Payment recorded. Receipt emailed to the customer."
        : "Payment recorded.",
    };
  },
});
export const reverseInvoicePaymentAction = defineShopAction({
  name: "reverseInvoicePayment",
  ownerOnly: true,
  input: z.object({ paymentId: z.uuid(), reason: z.string().min(1).max(1000) }),
  run: ({ tx, meta }, i) =>
    reverseInvoicePayment(tx, meta, i.paymentId, i.reason),
});
export const voidInvoiceAction = defineShopAction({
  name: "voidInvoice",
  ownerOnly: true,
  input: z.object({ id: z.uuid(), reason: z.string().min(1).max(1000) }),
  run: ({ tx, meta }, i) => voidInvoice(tx, meta, i.id, i.reason),
});
export const rotateInvoiceLinkAction = defineShopAction({
  name: "rotateInvoiceLink",
  input: z.object({ id: z.uuid() }),
  run: ({ tx, meta }, i) => rotateInvoiceLink(tx, meta, i.id),
  persist: (r) => ({ id: r.id }),
});

export const setInvoiceDisputeAction = defineShopAction({
  name: "setInvoiceDispute",
  input: z.object({ id: z.uuid(), reason: z.string().max(1000) }),
  run: ({ tx, meta }, i) =>
    setInvoiceDispute(tx, meta, i.id, i.reason.trim() || null),
  persist: (r) => ({
    ...r,
    message: "Dispute status updated. Invoice balance unchanged.",
  }),
});
