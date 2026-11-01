"use server";
import { z } from "zod";
import { addNote, changeNote, recordMileage } from "@/domain/memory";
import { defineShopAction } from "./define";
const base = { customerId: z.uuid() };
export const addNoteAction = defineShopAction({
  name: "addNote",
  input: z.object({
    ...base,
    vehicleId: z.uuid().optional(),
    body: z.string().min(1).max(5000),
  }),
  run: ({ tx }, i) => addNote(tx, i.customerId, i.vehicleId ?? null, i.body),
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
