"use server";
import { z } from "zod";
import {
  setInvoiceDisplay,
  setInvoiceTemplate,
} from "@/domain/invoice-display";
import { defineShopAction } from "./define";

export const setInvoiceDisplayAction = defineShopAction({
  name: "setInvoiceDisplay",
  input: z.object({ invoiceId: z.uuid(), display: z.unknown() }),
  run: ({ tx, meta }, i) =>
    setInvoiceDisplay(tx, meta, i.invoiceId, i.display ?? null),
});

export const setInvoiceTemplateAction = defineShopAction({
  name: "setInvoiceTemplate",
  ownerOnly: true,
  input: z.object({ display: z.unknown() }),
  run: ({ tx, meta }, i) => setInvoiceTemplate(tx, meta, i.display),
});
