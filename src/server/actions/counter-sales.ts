"use server";
import { z } from "zod";
import {
  createCounterSale,
  saleInput,
  voidCounterSale,
} from "@/domain/counter-sales";
import { defineShopAction } from "./define";

export const createCounterSaleAction = defineShopAction({
  name: "createCounterSale",
  input: saleInput,
  run: ({ tx, meta }, i) => createCounterSale(tx, meta, i),
});

export const voidCounterSaleAction = defineShopAction({
  name: "voidCounterSale",
  ownerOnly: true,
  input: z.object({ id: z.uuid(), reason: z.string().max(500) }),
  run: async ({ tx, meta }, i) => {
    const r = await voidCounterSale(tx, meta, i);
    return { ...r, message: "Sale voided. Parts are back on the shelf." };
  },
});
