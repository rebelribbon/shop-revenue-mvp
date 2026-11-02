"use server";
import { z } from "zod";
import {
  createAppointment,
  rescheduleAppointment,
  setAppointmentStatus,
} from "@/domain/appointments";
import { defineShopAction } from "./define";

export const createAppointmentAction = defineShopAction({
  name: "createAppointment",
  input: z.object({
    customerId: z.uuid(),
    sourceRecoveryItemId: z.uuid().optional(),
    sourceContactActivityId: z.uuid().optional(),
    serviceAssetId: z.union([z.uuid(), z.literal("")]).optional(),
    vehicleId: z.string().optional().or(z.literal("")),
    startsAt: z.string().min(1).max(32),
    reason: z.string().max(200).optional().or(z.literal("")),
    notes: z.string().max(5000).optional().or(z.literal("")),
  }),
  run: ({ tx, meta }, input) =>
    createAppointment(tx, meta, {
      customerId: input.customerId,
      sourceRecoveryItemId: input.sourceRecoveryItemId,
      sourceContactActivityId: input.sourceContactActivityId,
      vehicleId: input.vehicleId || null,
      serviceAssetId: input.serviceAssetId || null,
      localStartsAt: input.startsAt,
      reason: input.reason || null,
      notes: input.notes || null,
    }),
  persist: (row) => ({ id: row.id, message: "Appointment scheduled." }),
});

export const setAppointmentStatusAction = defineShopAction({
  name: "setAppointmentStatus",
  input: z.object({
    appointmentId: z.uuid(),
    status: z.enum(["scheduled", "completed", "cancelled", "no_show"]),
  }),
  run: ({ tx, meta }, input) =>
    setAppointmentStatus(tx, meta, input.appointmentId, input.status),
  persist: (row) => ({
    id: row.id,
    message: row.billed
      ? `Visit done. Invoice #${row.billed.number} is ready to send from Invoices.`
      : row.servicePlanId && row.status === "cancelled"
        ? "Visit skipped. The rest of the plan stays on the calendar."
        : "Appointment updated.",
  }),
});

export const rescheduleAppointmentAction = defineShopAction({
  name: "rescheduleAppointment",
  input: z.object({
    appointmentId: z.uuid(),
    startsAt: z.string().min(1).max(32),
  }),
  run: ({ tx, meta }, input) =>
    rescheduleAppointment(tx, meta, input.appointmentId, input.startsAt),
  persist: (row) => ({ id: row.id, message: "Visit moved." }),
});
