"use server";
import { businessTypes } from "@/lib/business-types";
import { z } from "zod";
import { updateBusinessProfile } from "@/domain/business-profile";
import { normalizePhone } from "@/lib/normalize";
import { defineShopAction } from "./define";

export const updateBusinessProfileAction = defineShopAction({
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
  }),
  run: ({ tx, meta }, input) => updateBusinessProfile(tx, meta, {
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
  }),
  persist: () => ({ message: "Business profile updated." }),
});

