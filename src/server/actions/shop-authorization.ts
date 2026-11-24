"use server";
import { z } from "zod";
import { defineShopAction } from "./define";
import { enableShopAuthorization } from "@/domain/shop-authorization";

export const enableShopAuthorizationAction = defineShopAction({
  name: "enableShopAuthorization",
  ownerOnly: true,
  allowWhenUnpaid: true,
  input: z.object({
    body: z.string().trim().min(20).max(8000),
    confirmed: z.literal("on"),
  }),
  run: async ({ tx, meta }, input) => {
    const terms = await enableShopAuthorization(tx, meta, {
      body: input.body,
      confirmed: input.confirmed === "on",
    });
    return { id: terms.id, version: terms.version };
  },
});
