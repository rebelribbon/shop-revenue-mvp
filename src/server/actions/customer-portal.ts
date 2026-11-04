"use server";
import { z } from "zod";
import { createPortalLink } from "@/domain/customer-portal";
import { defineShopAction } from "./define";

export const createPortalLinkAction = defineShopAction({
  name: "createPortalLink",
  input: z.object({ customerId: z.uuid() }),
  run: ({ tx, meta }, i) => createPortalLink(tx, meta, i.customerId),
  persist: (r) => ({ ...r, message: "Customer link ready." }),
});
