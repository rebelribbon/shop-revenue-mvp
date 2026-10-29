"use server";
import { z } from "zod";
import { createAppointment, setAppointmentStatus } from "@/domain/appointments";
import { defineShopAction } from "./define";

export const createAppointmentAction = defineShopAction({
  name: "createAppointment",
  input: z.object({
    customerId: z.uuid(),
    sourceRecoveryItemId: z.uuid().optional(),
    vehicleId: z.string().optional().or(z.literal("")),
    startsAt: z.string().min(1).max(32),
    reason: z.string().max(200).optional().or(z.literal("")),
    notes: z.string().max(5000).optional().or(z.literal("")),
  }),
  run: ({ tx, meta }, input) => createAppointment(tx, meta, {
    customerId: input.customerId,
    sourceRecoveryItemId: input.sourceRecoveryItemId,
    vehicleId: input.vehicleId || null,
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
  run: ({ tx, meta }, input) => setAppointmentStatus(tx, meta, input.appointmentId, input.status),
  persist: (row) => ({ id: row.id, message: "Appointment updated." }),
});

