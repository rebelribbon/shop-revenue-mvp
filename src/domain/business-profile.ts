import { eq } from "drizzle-orm";
import { business } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import type { RequestMeta } from "./records";
import { audit, recordActivity } from "./records";

export async function getBusinessProfile(tx: TenantTx) {
  const [row] = await tx.select().from(business).where(eq(business.id, tx.businessId));
  return row;
}

export async function updateBusinessProfile(tx: TenantTx, meta: RequestMeta, input: {
  legalName: string;
  dba?: string | null;
  phoneE164?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  timezone: string;
}) {
  const [before] = await tx.select().from(business).where(eq(business.id, tx.businessId));
  const [row] = await tx.update(business).set({
    legalName: input.legalName,
    dba: input.dba || null,
    phoneE164: input.phoneE164 || null,
    addressLine1: input.addressLine1 || null,
    addressLine2: input.addressLine2 || null,
    city: input.city || null,
    region: input.region || null,
    postalCode: input.postalCode || null,
    timezone: input.timezone,
  }).where(eq(business.id, tx.businessId)).returning();
  await audit(tx, meta, {
    action: "business.profile_updated",
    targetType: "business",
    targetId: tx.businessId,
    before: before ? { legalName: before.legalName, dba: before.dba, timezone: before.timezone } : null,
    after: { legalName: row.legalName, dba: row.dba, timezone: row.timezone },
  });
  await recordActivity(tx, { kind: "business.updated", subjectType: "business", subjectId: tx.businessId, summary: "Business profile updated" });
  return row;
}
