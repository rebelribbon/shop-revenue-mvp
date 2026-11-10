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
        eq(activity.businessId, tx.businessId),
        eq(activity.kind, "job.costed"),
        eq(activity.subjectId, jobId),
      ),
    )
    .limit(1);
  return (j?.data as { customerId?: string } | undefined)?.customerId;
}

export async function prepareMediaUpload(
  tx: TenantTx,
  input: { customerId: string; contentType: string; byteSize: number },
) {
  await getCustomerWithVehicles(tx, input.customerId);
  const type = MEDIA_TYPES[input.contentType];
  if (!type)
    throw new AppError(
      "VALIDATION",
      "Use a photo (JPG, PNG, HEIC) or a video (MP4, MOV).",
    );
  const max = type.video ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
  if (input.byteSize <= 0 || input.byteSize > max)
    throw new AppError(
      "VALIDATION",
      type.video
        ? "Videos can be up to 150 MB (about a minute)."
        : "Photos can be up to 15 MB.",
    );
  const id = randomUUID();
  const storageKey = `b/${tx.businessId}/job_media/${id}.${type.ext}`;
  await tx.insert(file).values({
    id,
    businessId: tx.businessId,
    createdByUserId: tx.actor.type === "user" ? tx.actor.id : null,
    storageKey,
    kind: "job_media",
    contentType: input.contentType,
    byteSize: input.byteSize,
  });
  return { fileId: id, uploadUrl: await createUploadUrl(storageKey) };
}

export async function finishMediaUpload(
  tx: TenantTx,
  meta: RequestMeta,
  input: {
    fileId: string;
    customerId: string;
    jobId?: string | null;
    vehicleId?: string | null;
    serviceAssetId?: string | null;
    appointmentId?: string | null;
    tag: MediaTag;
    caption?: string | null;
    showCustomer?: boolean;
  },
) {
  const [f] = await tx
    .select()
    .from(file)
    .where(
      and(
        eq(file.businessId, tx.businessId),
        eq(file.id, input.fileId),
        eq(file.kind, "job_media"),
      ),
    )
    .for("update");
  if (!f || f.status !== "pending") throw notFound("That upload");
  if (input.jobId && (await jobCustomer(tx, input.jobId)) !== input.customerId)
    throw notFound("That job");
  const stored = await statObject(f.storageKey);
  const type = MEDIA_TYPES[f.contentType];
  if (
    !stored ||
    stored.size <= 0 ||
    stored.size > (type?.video ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES)
  )
    throw new AppError(
      "VALIDATION",
      "The upload didn’t finish. Please try again.",
    );
  await tx
    .update(file)
    .set({ status: "ready", byteSize: stored.size })
    .where(and(eq(file.businessId, tx.businessId), eq(file.id, f.id)));
  const [row] = await tx
    .insert(jobMedia)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.type === "user" ? tx.actor.id : null,
      customerId: input.customerId,
      jobId: input.jobId ?? null,
      vehicleId: input.vehicleId ?? null,
      serviceAssetId: input.serviceAssetId ?? null,
      appointmentId: input.appointmentId ?? null,
      fileId: f.id,
      mediaType: type?.video ? "video" : "photo",
      tag: input.tag,
      caption: input.caption?.trim() || null,
      // Uploads always start private. A staff/owner advisor must approve sharing separately.
      showCustomer: false,
    })
    .returning();
  await recordActivity(tx, {
    kind: "media.added",
    subjectType: "customer",
    subjectId: input.customerId,
    summary: `${row.mediaType === "video" ? "Video" : "Photo"} added: ${TAG_LABELS[row.tag]}${row.caption ? ` · ${row.caption}` : ""}`,
    data: { mediaId: row.id, ...(row.jobId ? { jobId: row.jobId } : {}) },
  });
  void meta;
  return { id: row.id };
}

export async function updateMedia(
  tx: TenantTx,
  input: {
    mediaId: string;
    tag?: MediaTag;
    caption?: string | null;
    showCustomer?: boolean;
    jobId?: string | null;
    remove?: boolean;
  },
  meta?: RequestMeta,
) {
  const [m] = await tx
    .select()
    .from(jobMedia)
    .where(
      and(
        eq(jobMedia.businessId, tx.businessId),
        eq(jobMedia.id, input.mediaId),
        isNull(jobMedia.deletedAt),
      ),
    );
  if (!m) throw notFound("That photo");
  if (input.showCustomer !== undefined) {
    const role = await currentMemberRole(tx);
    if (role !== "owner" && role !== "staff") {
      throw new AppError(
        "FORBIDDEN",
        "Only the owner or front office can approve customer-visible media.",
      );
    }
  }
  if (input.jobId && (await jobCustomer(tx, input.jobId)) !== m.customerId)
    throw notFound("That job");
  await tx
    .update(jobMedia)
    .set({
      ...(input.tag ? { tag: input.tag } : {}),
      ...(input.caption !== undefined
        ? { caption: input.caption?.trim() || null }
        : {}),
      ...(input.showCustomer !== undefined
        ? { showCustomer: input.showCustomer }
        : {}),
      ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
      ...(input.remove ? { deletedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(jobMedia.businessId, tx.businessId), eq(jobMedia.id, m.id)));
  if (
    meta &&
    input.showCustomer !== undefined &&
    input.showCustomer !== m.showCustomer
  ) {
    await audit(tx, meta, {
      action: "media.customer_visibility_changed",
      targetType: "job_media",
      targetId: m.id,
      before: { showCustomer: m.showCustomer },
      after: { showCustomer: input.showCustomer, jobId: m.jobId },
    });
  }
  return { id: m.id };
}

export async function listMedia(
  tx: TenantTx,
  filter: { customerId?: string; jobId?: string },
) {
  return tx
    .select()
    .from(jobMedia)
    .where(
      and(
        eq(jobMedia.businessId, tx.businessId),
        filter.customerId
          ? eq(jobMedia.customerId, filter.customerId)
          : undefined,
        filter.jobId ? eq(jobMedia.jobId, filter.jobId) : undefined,
        isNull(jobMedia.deletedAt),
      ),
    )
    .orderBy(desc(jobMedia.createdAt))
    .limit(200);
}
export type MediaItem = Awaited<ReturnType<typeof listMedia>>[number];

// The photos a customer should see on this job's next estimate.
export async function estimatePhotos(tx: TenantTx, jobId: string) {
  const rows = await tx
    .select()
    .from(jobMedia)
    .where(
      and(
        eq(jobMedia.businessId, tx.businessId),
        eq(jobMedia.jobId, jobId),
        eq(jobMedia.showCustomer, true),
        isNull(jobMedia.deletedAt),
      ),
    )
    .orderBy(jobMedia.createdAt);
  return rows.map((m) => ({
    fileId: m.fileId,
    mediaType: m.mediaType,
    tag: m.tag,
    caption: m.caption,
  }));
}

// Storage key for a shop user viewing their own file.
export async function shopMediaKey(tx: TenantTx, fileId: string) {
  // Technicians may open only media associated with repair orders currently
  // assigned to their authenticated account, not arbitrary shop/customer files.
  if ((await currentMemberRole(tx)) === "technician") {
    if (tx.actor.type !== "user" || !tx.actor.id) return null;
    const [allowed] = await tx
      .select({ fileId: jobMedia.fileId })
      .from(jobMedia)
      .innerJoin(
        jobAssignment,
        and(
          eq(jobAssignment.businessId, jobMedia.businessId),
          eq(jobAssignment.jobId, jobMedia.jobId),
        ),
      )
      .where(
        and(
          eq(jobMedia.businessId, tx.businessId),
          eq(jobMedia.fileId, fileId),
          eq(jobAssignment.userId, tx.actor.id),
          isNull(jobMedia.deletedAt),
        ),
      )
      .limit(1);
    if (!allowed) return null;
  }
  const [f] = await tx
    .select({ key: file.storageKey, status: file.status })
    .from(file)
    .where(and(eq(file.businessId, tx.businessId), eq(file.id, fileId)));
  return f?.status === "ready" ? f.key : null;
}
