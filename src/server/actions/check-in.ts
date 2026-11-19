"use server";
import { z } from "zod";
import { assignJob } from "@/domain/assignments";
import { currentMemberRole } from "@/domain/membership";
import { prepareHandoffPing, sendHandoffPing } from "@/domain/handoff-pings";
import { createJob } from "@/domain/jobs";
import { checkInTitle } from "@/lib/check-in";
import { defineShopAction } from "./define";

// Vehicle check-in: opens the RO with what the advisor knows at the counter
// (customer, vehicle, miles, concerns) and hands it to a technician. Parts,
// labor and prices come later, when the estimate is built.
export const checkInAction = defineShopAction({
  name: "checkInVehicle",
  input: z.object({
    customerId: z.uuid(),
    vehicleId: z.uuid(),
    mileageIn: z.number().int().min(0).max(3000000).nullable(),
    concerns: z.string().trim().min(1).max(2000),
    technicianUserId: z.uuid().nullable(),
    approvedInspection: z.boolean().optional(),
    sourceRecoveryItemId: z.uuid().optional(),
    sourceContactActivityId: z.uuid().optional(),
    sourceAppointmentId: z.uuid().optional(),
  }),
  run: async ({ tx, meta }, i) => {
    // Check-in must assign an advisor before the inspection-first RO is saved.
    // One-person owner shops can own the advisor and technician roles at once.
    const advisorUserId = tx.actor.type === "user" ? tx.actor.id : null;
    const owner = (await currentMemberRole(tx)) === "owner";
    const job = await createJob(tx, {
      advisorUserId: advisorUserId ?? undefined,
      customerId: i.customerId,
      vehicleId: i.vehicleId,
      title: checkInTitle(i.concerns),
      // Estimate pricing waits for the technician's inspection.
      inspectionFirst: true,
      ...(i.approvedInspection ? { inspectionTemplateVersion: "approved-2026" as const } : {}),
      mileageIn: i.mileageIn,
      concerns: i.concerns,
      sourceRecoveryItemId: i.sourceRecoveryItemId,
      sourceContactActivityId: i.sourceContactActivityId,
      sourceAppointmentId: i.sourceAppointmentId,
      parts: [],
      labor: [],
    });
    // createJob records the advisor and customer ownership atomically.
    // When no technician was selected, the owner becomes their own tech.
    const technicianUserId =
      i.technicianUserId ?? (owner ? advisorUserId : null);
    const assigned = technicianUserId
      ? await assignJob(tx, meta, {
          jobId: job.id,
          userId: technicianUserId,
        })
      : null;
    return {
      id: job.id,
      tech: assigned?.tech ?? null,
      ping: assigned?.handoff ? await prepareHandoffPing(tx, job.id) : null,
    };
  },
  persist: (r) => ({ ...r, ping: null }),
  afterCommit: async ({ ping, ...r }) => ({
    ...r,
    emailed: await sendHandoffPing(ping),
  }),
});
