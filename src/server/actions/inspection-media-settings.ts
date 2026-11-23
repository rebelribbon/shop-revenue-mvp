"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { setInspectionMediaRequirements } from "@/domain/inspection-media-settings";
import { defineShopAction } from "./define";

const saveRequirements = defineShopAction({
  name: "setInspectionMediaRequirements",
  ownerOnly: true,
  allowWhenUnpaid: true,
  input: z.object({
    photos: z.enum(["on", "true"]).optional(),
    videos: z.enum(["on", "true"]).optional(),
  }),
  run: ({ tx, meta }, input) =>
    setInspectionMediaRequirements(tx, meta, {
      photos: input.photos !== undefined,
      videos: input.videos !== undefined,
    }),
  persist: () => ({ message: "Inspection requirements saved." }),
});

export async function saveInspectionMediaRequirementsAction(input: unknown) {
  const result = await saveRequirements(input);
  if (result.ok) revalidatePath("/app", "layout");
  return result;
}
