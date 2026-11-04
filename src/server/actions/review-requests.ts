"use server";
import { z } from "zod";
import {
  prepareReviewNow,
  saveReviewSettings,
  sendPreparedReview,
} from "@/domain/review-requests";
import { defineShopAction } from "./define";

export const askForReviewAction = defineShopAction({
  name: "askForReview",
  input: z.object({
    customerId: z.uuid().optional(),
    invoiceId: z.uuid().optional(),
  }),
  run: ({ tx }, i) => prepareReviewNow(tx, i),
  persist: (p) => ({ customerId: p.customerId, to: p.email.to }),
  afterCommit: (p, session) =>
    sendPreparedReview(session.businessId, session.actor, p),
});

export const saveReviewSettingsAction = defineShopAction({
  name: "saveReviewSettings",
  ownerOnly: true,
  input: z.object({
    on: z.enum(["true", "false"]).transform((v) => v === "true"),
    link: z.string().max(500).default(""),
  }),
  run: async ({ tx, meta }, i) => {
    const r = await saveReviewSettings(tx, meta, i);
    return {
      ...r,
      message: r.on
        ? "Review requests on: we’ll ask after each paid-in-full invoice."
        : "Review link saved. Automatic requests are off.",
    };
  },
});
