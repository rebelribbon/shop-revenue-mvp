import { foreignKey, integer, text, unique, uuid } from "drizzle-orm/pg-core";
import { app, tenantColumns } from "./common";
import { business, user } from "./tenancy";

// Each immutable version is explicitly enabled by this shop's owner. These
// records do not claim platform-admin or attorney approval.
export const shopAuthorizationTerms = app.table(
  "shop_authorization_terms",
  {
    ...tenantColumns(),
    createdByUserId: uuid("created_by_user_id").notNull(),
    version: integer("version").notNull(),
    jurisdictionCode: text("jurisdiction_code").notNull(),
    body: text("body").notNull(),
    bodySha256: text("body_sha256").notNull(),
  },
  (t) => [
    unique().on(t.businessId, t.id),
    unique().on(t.businessId, t.version),
    foreignKey({ columns: [t.businessId], foreignColumns: [business.id] }),
    foreignKey({ columns: [t.createdByUserId], foreignColumns: [user.id] }),
  ],
);
