"use server";
import { z } from "zod";
import { archiveCustomer, archiveVehicle, createCustomer, createVehicle, updateCustomer, updateVehicle } from "@/domain/customers";
import { normalizeEmail, normalizePhone } from "@/lib/normalize";
import { defineShopAction } from "./define";

const optionalInt = (min: number, max: number) =>
  z.preprocess((value) => (value === "" || value == null ? null : Number(value)), z.union([z.number().int().min(min).max(max), z.null()]));

const customerFields = z.object({
  firstName: z.string().max(100),
  lastName: z.string().max(100),
  email: z.string().max(254).optional().or(z.literal("")),
  phone: z.string().max(40).optional().or(z.literal("")),
  notes: z.string().max(5000).optional().or(z.literal("")),
});

const customerInput = (input: z.infer<typeof customerFields>) => ({
  firstName: input.firstName,
  lastName: input.lastName,
  email: input.email ? normalizeEmail(input.email) : null,
  phoneE164: input.phone ? normalizePhone(input.phone) : null,
  notes: input.notes || null,
});

export const createCustomerAction = defineShopAction({
  name: "createCustomer",
  input: customerFields,
  run: ({ tx, meta }, input) => createCustomer(tx, meta, customerInput(input)),
  persist: (row) => ({ id: row.id, displayName: row.displayName, redirectTo: `/app/customers/${row.id}` }),
  afterCommit: async (row) => ({ id: row.id, displayName: row.displayName, redirectTo: `/app/customers/${row.id}` }),
});

export const updateCustomerAction = defineShopAction({
  name: "updateCustomer",
  input: customerFields.extend({ customerId: z.uuid() }),
  run: ({ tx, meta }, input) => updateCustomer(tx, meta, input.customerId, customerInput(input)),
  persist: (row) => ({ id: row.id, message: "Customer updated." }),
});

export const archiveCustomerAction = defineShopAction({
  name: "archiveCustomer",
  input: z.object({ customerId: z.uuid() }),
  run: ({ tx, meta }, input) => archiveCustomer(tx, meta, input.customerId),
  persist: () => ({ message: "Customer archived.", redirectTo: "/app/customers" }),
  afterCommit: async () => ({ message: "Customer archived.", redirectTo: "/app/customers" }),
});

const vehicleFields = z.object({
  customerId: z.uuid(),
  year: optionalInt(1886, 2200),
  make: z.string().max(100).optional().or(z.literal("")),
  model: z.string().max(100).optional().or(z.literal("")),
  trim: z.string().max(100).optional().or(z.literal("")),
  vin: z.string().max(17).optional().or(z.literal("")),
  plate: z.string().max(20).optional().or(z.literal("")),
  mileage: optionalInt(0, 3000000),
  notes: z.string().max(5000).optional().or(z.literal("")),
});

const vehicleInput = (input: z.infer<typeof vehicleFields>) => ({
  customerId: input.customerId,
  year: input.year,
  make: input.make || null,
  model: input.model || null,
  trim: input.trim || null,
  vin: input.vin || null,
  plate: input.plate || null,
  mileage: input.mileage,
  notes: input.notes || null,
});

export const createVehicleAction = defineShopAction({
  name: "createVehicle",
  input: vehicleFields,
  run: ({ tx, meta }, input) => createVehicle(tx, meta, vehicleInput(input)),
  persist: (row) => ({ id: row.id, customerId: row.customerId, redirectTo: `/app/customers/${row.customerId}/vehicles/${row.id}` }),
  afterCommit: async (row) => ({ id: row.id, customerId: row.customerId, redirectTo: `/app/customers/${row.customerId}/vehicles/${row.id}` }),
});

export const updateVehicleAction = defineShopAction({
  name: "updateVehicle",
  input: vehicleFields.extend({ vehicleId: z.uuid() }),
  run: ({ tx, meta }, input) => updateVehicle(tx, meta, input.vehicleId, vehicleInput(input)),
  persist: (row) => ({ id: row.id, message: "Vehicle updated." }),
});

export const archiveVehicleAction = defineShopAction({
  name: "archiveVehicle",
  input: z.object({ customerId: z.uuid(), vehicleId: z.uuid() }),
  run: ({ tx, meta }, input) => archiveVehicle(tx, meta, input.customerId, input.vehicleId),
  persist: (row) => ({ message: "Vehicle archived.", redirectTo: `/app/customers/${row.customerId}` }),
  afterCommit: async (row) => ({ message: "Vehicle archived.", redirectTo: `/app/customers/${row.customerId}` }),
});
