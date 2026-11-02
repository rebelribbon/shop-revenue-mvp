"use server";
import { z } from "zod";
import {
  addNote,
  changeNote,
  recordMileage,
  setNoteHeadsUp,
} from "@/domain/memory";
import { defineShopAction } from "./define";
const base = { customerId: z.uuid() };
export const addNoteAction = defineShopAction({
  name: "addNote",
  input: z.object({
    ...base,
    vehicleId: z.uuid().optional(),
    jobId: z.uuid().optional(),
    kind: z.enum(["profile", "log"]).optional(),
    headsUp: z.enum(["on", "true"]).optional(),
    body: z.string().min(1).max(5000),
  }),
  run: ({ tx }, i) =>
    addNote(tx, i.customerId, i.vehicleId ?? null, i.body, {
      kind: i.kind,
      headsUp: i.headsUp !== undefined,
      jobId: i.jobId ?? null,
    }),
  persist: () => ({ message: "Note saved." }),
});
export const setNoteHeadsUpAction = defineShopAction({
  name: "setNoteHeadsUp",
  input: z.object({
    ...base,
    noteId: z.uuid(),
    headsUp: z.enum(["true", "false"]),
  }),
  run: ({ tx }, i) =>
    setNoteHeadsUp(tx, i.customerId, i.noteId, i.headsUp === "true"),
});
export const editNoteAction = defineShopAction({
  name: "editNote",
  input: z.object({
    ...base,
    noteId: z.uuid(),
    body: z.string().min(1).max(5000),
    expectedUpdatedAt: z.iso.datetime(),
  }),
  run: ({ tx }, i) =>
    changeNote(tx, i.customerId, i.noteId, i.body, i.expectedUpdatedAt),
});
export const deleteNoteAction = defineShopAction({
  name: "deleteNote",
  input: z.object({
    ...base,
    noteId: z.uuid(),
    expectedUpdatedAt: z.iso.datetime(),
  }),
  run: ({ tx }, i) =>
    changeNote(tx, i.customerId, i.noteId, null, i.expectedUpdatedAt),
});
export const recordMileageAction = defineShopAction({
  name: "recordMileage",
  input: z.object({
    ...base,
    vehicleId: z.uuid(),
    value: z.coerce.number().int().min(0).max(3000000),
  }),
  run: ({ tx }, i) => recordMileage(tx, i.customerId, i.vehicleId, i.value),
});
