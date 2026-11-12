"use server";
import { z } from "zod";
import { assignAdvisor, assignCustomer, assignJob, assignVisit } from "@/domain/assignments";
import {
  prepareHandoffPing,
  sendHandoffPing,
  setHandoffPings,
} from "@/domain/handoff-pings";
import { defineShopAction } from "./define";

// "" from the picker means nobody.
const who = z
  .union([z.uuid(), z.literal("")])
  .transform((v) => (v === "" ? null : v));

export const assignJobAction = defineShopAction({
  name: "assignJob",
  input: z.object({ jobId: z.uuid(), userId: who }),
  run: async ({ tx, meta }, i) => {
    const r = await assignJob(tx, meta, i);
    return {
      ...r,
      message: r.tech ? `${r.tech} is on this job.` : "Nobody is on this job.",
      // The technician is emailed after this commits.
      ping: r.handoff ? await prepareHandoffPing(tx, i.jobId) : null,
    };
  },
  // The stored replay never keeps the email itself.
  persist: (r) => ({ ...r, ping: null }),
  afterCommit: async ({ ping, ...r }) => {
    const emailed = await sendHandoffPing(ping);
    return {
      ...r,
      message: emailed ? `${r.message} They’ve been emailed.` : r.message,
    };
  },
});

export const assignVisitAction = defineShopAction({
  name: "assignVisit",
  input: z.object({ appointmentId: z.uuid(), userId: who }),
  run: async ({ tx, meta }, i) => {
    const r = await assignVisit(tx, meta, i);
    return {
      ...r,
      message: r.tech
        ? `${r.tech} is on this visit.`
        : "Nobody is on this visit.",
    };
  },
});

export const assignAdvisorAction = defineShopAction({
  name: "assignAdvisor",
  input: z.object({ jobId: z.uuid(), userId: z.uuid() }),
  run: async ({ tx, meta }, input) => {
    const r = await assignAdvisor(tx, meta, input);
    return {
      ...r,
      message: `${r.advisor} is the assigned service advisor.`,
      // A waiting estimate moved to them: they're emailed after commit.
      ping: r.handoff ? await prepareHandoffPing(tx, input.jobId) : null,
    };
  },
  // The stored replay never keeps the email itself.
  persist: (r) => ({ ...r, ping: null }),
  afterCommit: async ({ ping, ...r }) => {
    const emailed = await sendHandoffPing(ping);
    return {
      ...r,
      message: emailed ? `${r.message} They’ve been emailed.` : r.message,
    };
  },
});

export const setHandoffPingsAction = defineShopAction({
  name: "setHandoffPings",
  ownerOnly: true,
  input: z.object({
    on: z.enum(["true", "false"]).transform((v) => v === "true"),
  }),
  run: async ({ tx, meta }, i) => {
    const r = await setHandoffPings(tx, meta, i.on);
    return {
      ...r,
      message: r.on
        ? "Your team gets an email when work is handed to them."
        : "Handoff emails are off. Assigned work still shows in Tasks.",
    };
  },
});

export const assignCustomerAction = defineShopAction({
  name: "assignCustomer",
  input: z.object({ customerId: z.uuid(), userId: z.uuid() }),
  run: ({ tx, meta }, input) => assignCustomer(tx, meta, input),
});
