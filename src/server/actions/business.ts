"use server";
import { revalidatePath } from "next/cache";
import { businessTypes } from "@/lib/business-types";
import { z } from "zod";
import { updateBusinessProfile } from "@/domain/business-profile";
import { normalizePhone } from "@/lib/normalize";
import { defineShopAction } from "./define";

const saveBusinessProfile = defineShopAction({
  name: "updateBusinessProfile",
  ownerOnly: true,
  input: z.object({
    businessType: z.enum(businessTypes).optional(),
    legalName: z.string().min(1).max(200),
    dba: z.string().max(200).optional().or(z.literal("")),
    phone: z.string().max(40).optional().or(z.literal("")),
    addressLine1: z.string().max(200).optional().or(z.literal("")),
    addressLine2: z.string().max(200).optional().or(z.literal("")),
    city: z.string().max(120).optional().or(z.literal("")),
    region: z.string().max(60).optional().or(z.literal("")),
    postalCode: z.string().max(20).optional().or(z.literal("")),
    timezone: z.string().min(1).max(100),
    taxPercent: z.coerce.number().min(0).max(20).optional(),
    partsTaxableDefault: z.enum(["true", "false"]).optional(),
    laborTaxableDefault: z.enum(["true", "false"]).optional(),
  }),
  run: ({ tx, meta }, input) =>
    updateBusinessProfile(tx, meta, {
      businessType: input.businessType,
      legalName: input.legalName,
      dba: input.dba || null,
      phoneE164: input.phone ? normalizePhone(input.phone) : null,
      addressLine1: input.addressLine1 || null,
      addressLine2: input.addressLine2 || null,
      city: input.city || null,
      region: input.region || null,
      postalCode: input.postalCode || null,
      timezone: input.timezone,
      taxRateBps:
        input.taxPercent === undefined
          ? undefined
          : Math.round(input.taxPercent * 100),
      partsTaxableDefault:
        input.partsTaxableDefault === undefined
          ? undefined
          : input.partsTaxableDefault === "true",
      laborTaxableDefault:
        input.laborTaxableDefault === undefined
          ? undefined
          : input.laborTaxableDefault === "true",
    }),
  persist: () => ({ message: "Business profile updated." }),
});

// Invalidate after the tenant transaction commits, including successful retries.
// Every previously visited workspace page must use the newly saved industry.
export async function updateBusinessProfileAction(input: unknown) {
  const result = await saveBusinessProfile(input);
  if (result.ok) revalidatePath("/app", "layout");
  return result;
}
