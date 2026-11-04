"use server";
import { z } from "zod";
import {
  archivePart,
  countStock,
  receiveStock,
  savePart,
} from "@/domain/parts";
import { defineShopAction } from "./define";

// "12.50" → 1250; blank → null. Used for dollars and for quantities
// (stored in hundredths).
const hundredths = z
  .string()
  .trim()
  .max(20)
  .transform((v, ctx) => {
    if (v === "") return null;
    const n = Number(v.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n < 0) {
      ctx.addIssue({ code: "custom", message: "Enter a number." });
      return z.NEVER;
    }
    return Math.round(n * 100);
  });
const required = hundredths.refine((v) => v !== null, "Enter a number.");

export const savePartAction = defineShopAction({
  name: "savePart",
  input: z.object({
    id: z
      .uuid()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    name: z.string().max(200),
    partNumber: z.string().max(100).default(""),
    unitCost: hundredths.default(null),
    unitPrice: required,
    reorderAt: hundredths.default(null),
    onHand: hundredths.default(null),
  }),
  run: async ({ tx, meta }, i) => {
    const r = await savePart(tx, meta, {
      id: i.id,
      name: i.name,
      partNumber: i.partNumber,
      unitCostCents: i.unitCost,
      unitPriceCents: i.unitPrice!,
      reorderAtHundredths: i.reorderAt,
      startingHundredths: i.id ? undefined : (i.onHand ?? 0),
    });
    return {
      ...r,
      message: "Part saved.",
      redirectTo: `/app/parts?part=${r.id}`,
    };
  },
});

export const receiveStockAction = defineShopAction({
  name: "receiveStock",
  input: z.object({
    partItemId: z.uuid(),
    quantity: required,
    unitCost: hundredths.default(null),
  }),
  run: async ({ tx, meta }, i) => {
    const r = await receiveStock(tx, meta, {
      partItemId: i.partItemId,
      quantityHundredths: i.quantity!,
      unitCostCents: i.unitCost,
    });
    return { ...r, message: "Added to stock." };
  },
});

export const countStockAction = defineShopAction({
  name: "countStock",
  input: z.object({ partItemId: z.uuid(), counted: required }),
  run: async ({ tx, meta }, i) => {
    const r = await countStock(tx, meta, {
      partItemId: i.partItemId,
      countedHundredths: i.counted!,
    });
    return { ...r, message: "Count saved." };
  },
});

export const archivePartAction = defineShopAction({
  name: "archivePart",
  input: z.object({ partItemId: z.uuid() }),
  run: async ({ tx, meta }, i) => {
    const r = await archivePart(tx, meta, i.partItemId);
    return { ...r, message: "Removed.", redirectTo: "/app/parts" };
  },
});
