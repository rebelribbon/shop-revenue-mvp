"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MEDIA_TAGS } from "@/db/schema";
import {
  finishMediaUpload,
  prepareMediaUpload,
  updateMedia,
} from "@/domain/job-media";
import {
  requireAssignedCustomer,
  requireAssignedUpload,
  requireAssignedMedia,
} from "@/domain/job-access";
import { defineShopAction } from "./define";

export const prepareMediaUploadAction = defineShopAction({
  name: "prepareMediaUpload",
  technicianAccess: requireAssignedCustomer,
  input: z.object({
    customerId: z.uuid(),
    contentType: z.string().max(100),
    byteSize: z.number().int().positive(),
  }),
  run: ({ tx }, i) => prepareMediaUpload(tx, i),
  // The signed upload URL is short-lived; don't keep it.
  persist: (r) => ({ fileId: r.fileId }),
});

const finish = defineShopAction({
  name: "finishMediaUpload",
  technicianAccess: requireAssignedUpload,
  input: z.object({
    fileId: z.uuid(),
    customerId: z.uuid(),
    jobId: z.uuid().optional(),
    vehicleId: z.uuid().optional(),
    serviceAssetId: z.uuid().optional(),
    appointmentId: z.uuid().optional(),
    tag: z.enum(MEDIA_TAGS),
    caption: z.string().max(500).optional(),
    mediaPurpose: z.enum(["general", "intake", "finding", "walkaround"]).optional(),
    inspectionItemKey: z.string().max(60).optional(),
    showCustomer: z.boolean().optional(),
  }),
  run: ({ tx, meta }, i) => finishMediaUpload(tx, meta, i),
});
export async function finishMediaUploadAction(input: unknown) {
  const r = await finish(input);
  if (r.ok) revalidatePath("/app", "layout");
  return r;
}

export const updateMediaAction = defineShopAction({
  name: "updateMedia",
  technicianAccess: requireAssignedMedia,
  input: z.object({
    mediaId: z.uuid(),
    tag: z.enum(MEDIA_TAGS).optional(),
    caption: z.string().max(500).optional(),
    showCustomer: z.enum(["true", "false"]).optional(),
    jobId: z.uuid().optional(),
    remove: z.enum(["true"]).optional(),
  }),
  run: ({ tx, meta }, i) =>
    updateMedia(
      tx,
      {
        mediaId: i.mediaId,
        tag: i.tag,
        caption: i.caption,
        showCustomer:
          i.showCustomer === undefined ? undefined : i.showCustomer === "true",
        jobId: i.jobId,
        remove: i.remove === "true",
      },
      meta,
    ),
  persist: () => ({ message: "Saved." }),
});
