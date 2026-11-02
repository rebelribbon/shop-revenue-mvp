import { boolean, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { app, tenantColumns } from "./common";

export const MEDIA_TAGS = [
  "before",
  "after",
  "issue",
  "quote",
  "other",
] as const;
export type MediaTag = (typeof MEDIA_TAGS)[number];

// A photo or video from the field (migration 0030).
export const jobMedia = app.table("job_media", {
  ...tenantColumns(),
  customerId: uuid("customer_id").notNull(),
  jobId: uuid("job_id"),
  vehicleId: uuid("vehicle_id"),
  serviceAssetId: uuid("service_asset_id"),
  appointmentId: uuid("appointment_id"),
  fileId: uuid("file_id").notNull(),
  mediaType: text("media_type").$type<"photo" | "video">().notNull(),
  tag: text("tag").$type<MediaTag>().notNull(),
  caption: text("caption"),
  showCustomer: boolean("show_customer").notNull().default(false),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
