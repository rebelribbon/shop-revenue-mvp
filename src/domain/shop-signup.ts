// Public enrollment is limited to a server-verified email identity. Creating
// the app identity is retryable; tenant, location, ownership and audit commit
// together. A per-identity lock prevents duplicate shops on concurrent retries.
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withAdmin } from "@/db/admin";
import { business, location, membership, user } from "@/db/schema";
import { runInContext, type TenantTx } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import { audit, type RequestMeta } from "./records";

export const shopSignupInput = z.object({
  shopName: z.string().trim().min(1).max(200),
  ownerName: z.string().trim().min(1).max(100),
});
export type VerifiedShopIdentity = {
  authSubject: string;
  email: string;
  emailVerified: boolean;
};

export async function enrollShop(
  identity: VerifiedShopIdentity,
  raw: z.infer<typeof shopSignupInput>,
  meta: RequestMeta,
) {
  const input = shopSignupInput.parse(raw);
  if (
    !identity.emailVerified ||
    !z.uuid().safeParse(identity.authSubject).success ||
    !z.email().safeParse(identity.email).success
  )
    throw new AppError(
      "FORBIDDEN",
      "Confirm your email before creating a shop.",
    );
  const actor = {
    type: "user" as const,
    id: null,
    authSubject: identity.authSubject,
  };
  const owner = await runInContext(null, actor, async (tx) => {
    await tx
      .insert(user)
      .values({
        authProviderId: identity.authSubject,
        email: identity.email.toLowerCase(),
        displayName: input.ownerName,
      })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(user)
      .where(eq(user.authProviderId, identity.authSubject));
    if (!row || row.status !== "active")
      throw new AppError("FORBIDDEN", "This login is unavailable.");
    return row;
  });
  return withAdmin(null, async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"shop-signup:" + owner.id},0))`,
    );
    // The admin role normally has tenant-scoped RLS. The narrowly scoped
    // resolver returns only this verified user's existing owner membership.
    const prior = await tx.execute(
      sql`select * from app.signup_owner_business(${identity.authSubject}::uuid)`,
    );
    if (prior.rows.length) {
      if (
        prior.rows[0].business_status !== "active" ||
        prior.rows[0].membership_status !== "active"
      )
        throw new AppError(
          "FORBIDDEN",
          "Contact support to restore access to your shop.",
        );
      return { businessId: String(prior.rows[0].business_id) };
    }
    const [b] = await tx
      .insert(business)
      .values({
        legalName: input.shopName,
        timezone: "America/Chicago",
        jurisdictionCode: "US-TX",
      })
      .returning({ id: business.id });
    await tx.execute(sql`select set_config('app.business_id',${b.id},true)`);
    await tx
      .insert(location)
      .values({ businessId: b.id, name: input.shopName, isDefault: true });
    await tx.insert(membership).values({
      businessId: b.id,
      userId: owner.id,
      role: "owner",
      status: "active",
      inviteName: input.ownerName,
      inviteEmail: identity.email.toLowerCase(),
    });
    const tenant = Object.assign(Object.create(tx), {
      businessId: b.id,
      actor: { type: "internal", id: null },
    }) as TenantTx;
    await audit(tenant, meta, {
      action: "business.self_registered",
      targetType: "business",
      targetId: b.id,
      after: { ownerUserId: owner.id, authSubject: identity.authSubject },
    });
    return { businessId: b.id };
  });
}
