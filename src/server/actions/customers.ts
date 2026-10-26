"use server";
import { z } from "zod";
import { createCustomer, createVehicle } from "@/domain/customers";
import { normalizeEmail, normalizePhone } from "@/lib/normalize";
import { defineShopAction } from "./define";

export const createCustomerAction = defineShopAction({
  name: "createCustomer",
  input: z.object({
    firstName: z.string().max(100),
    lastName: z.string().max(100),
    email: z.string().max(254).optional().or(z.literal("")),
    phone: z.string().max(40).optional().or(z.literal("")),
    notes: z.string().max(5000).optional().or(z.literal("")),
  }),
  run: ({ tx, meta }, input) =>
    createCustomer(tx, meta, {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email ? normalizeEmail(input.email) : null,
      phoneE164: input.phone ? normalizePhone(input.phone) : null,
      notes: input.notes || null,
    }),
  persist: (row) => ({ id: row.id, displayName: row.displayName }),
});

export const createVehicleAction = defineShopAction({
  name: "createVehicle",
  input: z.object({
    customerId: z.uuid(),
    year: z.union([z.number().int().min(1886).max(2200), z.null()]).optional(),
    make: z.string().max(100).optional().or(z.literal("")),
    model: z.string().max(100).optional().or(z.literal("")),
    trim: z.string().max(100).optional().or(z.literal("")),
    vin: z.string().max(17).optional().or(z.literal("")),
    plate: z.string().max(20).optional().or(z.literal("")),
    mileage: z.union([z.number().int().min(0).max(3000000), z.null()]).optional(),
    notes: z.string().max(5000).optional().or(z.literal("")),
  }),
  run: ({ tx, meta }, input) =>
    createVehicle(tx, meta, {
      customerId: input.customerId,
      year: input.year ?? null,
      make: input.make || null,
      model: input.model || null,
      trim: input.trim || null,
      vin: input.vin || null,
      plate: input.plate || null,
      mileage: input.mileage ?? null,
      notes: input.notes || null,
    }),
  persist: (row) => ({ id: row.id, customerId: row.customerId }),
});
