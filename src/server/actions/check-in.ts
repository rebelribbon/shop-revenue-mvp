"use server";
import { z } from "zod";
import { assignAdvisor, assignJob } from "@/domain/assignments";
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
    sourceRecoveryItemId: z.uuid().optional(),
    sourceContactActivityId: z.uuid().optional(),
    sourceAppointmentId: z.uuid().optional(),
  }),
  run: async ({ tx, meta }, i) => {
    const job = await createJob(tx, {
      customerId: i.customerId,
      vehicleId: i.vehicleId,
      title: checkInTitle(i.concerns),
      // Estimate pricing waits for the technician's inspection.
      inspectionFirst: true,
      mileageIn: i.mileageIn,
      concerns: i.concerns,
      sourceRecoveryItemId: i.sourceRecoveryItemId,
      sourceContactActivityId: i.sourceContactActivityId,
      sourceAppointmentId: i.sourceAppointmentId,
      parts: [],
      labor: [],
    });
    // Whoever checks the vehicle in is its advisor, so the finished
    // inspection comes back to them.
    if (tx.actor.type === "user" && tx.actor.id)
      await assignAdvisor(tx, meta, { jobId: job.id, userId: tx.actor.id });
    const assigned = i.technicianUserId
      ? await assignJob(tx, meta, {
          jobId: job.id,
          userId: i.technicianUserId,
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
