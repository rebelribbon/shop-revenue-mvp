// Business lifecycle: createBusiness (internal admin, F1) and the shop's own
// profile updates (updateBusinessProfile).
import { eq, sql } from "drizzle-orm";
import { business, location, membership } from "@/db/schema";
import { withAdmin, type InternalActor } from "@/db/admin";
import type { TenantTx } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import { newToken } from "@/lib/tokens";
import { audit, recordActivity, type RequestMeta } from "./records";
import { INVITE_TTL_MS } from "./membership";

export type CreateBusinessInput = {
  legalName: string;
  dba?: string | null;
  phoneE164?: string | null;
  timezone?: string;
  owner: { name: string; email?: string | null; phoneE164?: string | null };
};

// One transaction: business, its default location (D4), the owner's invited
// membership and the audit rows. Returns the plaintext invite token once, for
// delivery after commit; only its hash is stored.
export async function createBusiness(actor: InternalActor, meta: RequestMeta, input: CreateBusinessInput) {
  if (!input.owner.email && !input.owner.phoneE164) {
    throw new AppError("VALIDATION", "The owner needs an email or a mobile number for the invite.");
  }
  const invite = newToken();
  return withAdmin(actor, async (tx) => {
    const [b] = await tx
      .insert(business)
      .values({
        legalName: input.legalName,
        dba: input.dba ?? null,
        phoneE164: input.phoneE164 ?? null,
        timezone: input.timezone ?? "America/Chicago",
        jurisdictionCode: "US-TX",
      })
      .returning({ id: business.id });
    // Enter the new tenant's context for the tenant-owned rows.
    await tx.execute(sql`SELECT set_config('app.business_id', ${b.id}, true)`);
    const ttx = Object.assign(Object.create(tx), {
      businessId: b.id,
      actor: { type: "internal", id: actor.internalUserId },
    }) as TenantTx;
    await tx.insert(location).values({ businessId: b.id, name: input.dba || input.legalName, isDefault: true });
    const [m] = await tx
      .insert(membership)
      .values({
        businessId: b.id,
        role: "owner",
        status: "invited",
        inviteName: input.owner.name,
        inviteEmail: input.owner.email ?? null,
        invitePhoneE164: input.owner.phoneE164 ?? null,
        inviteTokenHash: invite.hash,
        inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
      })
      .returning({ id: membership.id });
    await audit(ttx, meta, {
      action: "business.created",
      targetType: "business",
      targetId: b.id,
      after: { legalName: input.legalName, dba: input.dba ?? null },
    });
    await audit(ttx, meta, {
      action: "membership.invited",
      targetType: "membership",
      targetId: m.id,
      after: { role: "owner" },
    });
    return { businessId: b.id, ownerMembershipId: m.id, inviteToken: invite.token };
  });
}

export const PROFILE_FIELDS = [
  "legalName",
  "dba",
  "phoneE164",
  "addressLine1",
  "addressLine2",
  "city",
  "region",
  "postalCode",
  "timezone",
  "taxRateBps",
] as const;

export type BusinessProfile = Partial<Record<(typeof PROFILE_FIELDS)[number], string | number | null>>;

export async function updateBusinessProfile(tx: TenantTx, meta: RequestMeta, input: BusinessProfile) {
  const [before] = await tx.select().from(business).where(eq(business.id, tx.businessId));
  if (!before) throw new AppError("NOT_FOUND", "Business not found.");
  const patch = Object.fromEntries(PROFILE_FIELDS.filter((k) => k in input).map((k) => [k, input[k]]));
  if (!Object.keys(patch).length) return before;
  const [after] = await tx.update(business).set(patch).where(eq(business.id, tx.businessId)).returning();
  await tx
    .update(location)
    .set({
      addressLine1: after.addressLine1,
      addressLine2: after.addressLine2,
      city: after.city,
      region: after.region,
      postalCode: after.postalCode,
    })
    .where(sql`${location.businessId} = ${tx.businessId} AND ${location.isDefault}`);
  const pick = (r: typeof before) => Object.fromEntries(Object.keys(patch).map((k) => [k, r[k as keyof typeof r]]));
  await audit(tx, meta, {
    action: "business.profile_updated",
    targetType: "business",
    targetId: tx.businessId,
    before: pick(before),
    after: pick(after),
  });
  await recordActivity(tx, {
    kind: "business.updated",
    subjectType: "business",
    subjectId: tx.businessId,
    summary: "Business profile updated",
    data: { fields: Object.keys(patch) },
  });
  return after;
}
