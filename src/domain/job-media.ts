// Field photos and videos: upload (prepare -> browser PUT -> finish), tag,
// caption, choose what the customer sees, and attach to jobs.
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  activity,
  file,
  jobAssignment,
  jobMedia,
  type MediaTag,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError, notFound } from "@/lib/errors";
import { createUploadUrl, statObject } from "@/lib/media-storage";
import { getCustomerWithVehicles } from "./customers";
import { currentMemberRole } from "./membership";
import { inspectionPoints } from "@/lib/vehicle-inspection";
import { audit, recordActivity, type RequestMeta } from "./records";

export const MEDIA_TYPES: Record<string, { ext: string; video: boolean }> = {
  "image/jpeg": { ext: "jpg", video: false },
  "image/png": { ext: "png", video: false },
  "image/webp": { ext: "webp", video: false },
  "image/heic": { ext: "heic", video: false },
  "video/mp4": { ext: "mp4", video: true },
  "video/quicktime": { ext: "mov", video: true },
  "video/webm": { ext: "webm", video: true },
};
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 150 * 1024 * 1024;

export { TAG_LABELS } from "@/lib/media-tags";
import { TAG_LABELS } from "@/lib/media-tags";

async function jobCustomer(tx: TenantTx, jobId: string) {
  const [j] = await tx
    .select({ data: activity.data })
    .from(activity)
    .where(
      and(
        ¶»§q«^