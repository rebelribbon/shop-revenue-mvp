import { sql } from "drizzle-orm";
import { pgSchema, timestamp, uuid } from "drizzle-orm/pg-core";

// Every table lives in the `app` schema, which Supabase's Data API never exposes
// and which only migration_owner can create objects in.
export const app = pgSchema("app");

export const E164_CHECK = sql.raw(`'^\\+[1-9][0-9]{7,14}$'`);

export const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`app.uuid_v7()`);

export const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Standard tenant-table columns (Section 7): id, business_id, created_at,
// updated_at, created_by_user_id. UNIQUE (business_id, id) is declared per table.
export const tenantColumns = () => ({
  id: id(),
  businessId: uuid("business_id").notNull(),
  ...timestamps(),
  createdByUserId: uuid("created_by_user_id"),
});
