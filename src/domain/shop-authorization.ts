import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  business,
  shopAuthorizationTerms,
  type AuthorizationPolicy,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import { assertOwner } from "./membership";
import { audit, recordActivity, type RequestMeta } from "./records";

export function shopTermsPolicy(
  terms: typeof shopAuthorizationTerms.$inferSelect,
): AuthorizationPolicy {
  return {
    source: "shop",
    businessId: terms.businessId,
    id: terms.id,
    version: terms.version,
    jurisdictionCode: terms.jurisdictionCode,
    body: terms.body,
    bodySha256: terms.bodySha256,
  };
}

export async function activeShopAuthorization(tx: TenantTx) {
  const [terms] = await tx
    .select()
    .from(shopAuthorizationTerms)
    .where(eq(shopAuthorizationTerms.businessId, tx.businessId))
    .orderBy(desc(shopAuthorizationTerms.version))
    .limit(1);
  return terms ?? null;
}

export async function enableShopAuthorization(
  tx: TenantTx,
  meta: RequestMeta,
  input: { body: string; confirmed: boolean },
) {
  await assertOwner(tx);
  const ownerId = tx.actor.id;
  if (!ownerId) throw new AppError("FORBIDDEN", "Sign in as the shop owner.");
  const body = input.body.trim();
  if (!input.confirmed || body.length < 20 || body.length > 8000)
    throw new AppError(
      "VALIDATION",
      "Enter your shop’s authorization terms and confirm you reviewed them.",
    );
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`shop-authorization:${tx.businessId}`}, 0))`,
  );
  const prior = await activeShopAuthorization(tx);
  const [shop] = await tx
    .select({ jurisdictionCode: business.jurisdictionCode })
    .from(business)
    .where(eq(business.id, tx.businessId));
  if (prior?.body === body && prior.jurisdictionCode === shop.jurisdictionCode)
    return prior;
  const [terms] = await tx
    .insert(shopAuthorizationTerms)
    .values({
      businessId: tx.businessId,
      createdByUserId: ownerId,
      version: (prior?.version ?? 0) + 1,
      jurisdictionCode: shop.jurisdictionCode,
      body,
      bodySha256: createHash("sha256").update(body).digest("hex"),
    })
    .returning();
  await audit(tx, meta, {
    action: "shop_authorization.enabled",
    targetType: "shop_authorization_terms",
    targetId: terms.id,
    after: {
      version: terms.version,
      bodySha256: terms.bodySha256,
      enabledBy: tx.actor.id,
    },
  });
  await recordActivity(tx, {
    kind: "business.authorization_enabled",
    subjectType: "business",
    subjectId: tx.businessId,
    summary: `Owner enabled customer authorization terms v${terms.version}`,
  });
  return terms;
}

export async function resolveAuthorizationPolicy(
  tx: TenantTx,
  jurisdictionCode: string,
): Promise<AuthorizationPolicy | null> {
  const terms = await activeShopAuthorization(tx);
  if (terms?.jurisdictionCode === jurisdictionCode)
    return shopTermsPolicy(terms);
  const { legalPolicy } = await import("@/db/schema");
  const [policy] = await tx
    .select()
    .from(legalPolicy)
    .where(
      and(
        eq(legalPolicy.jurisdictionCode, jurisdictionCode),
        eq(legalPolicy.kind, "estimate_authorization"),
        eq(legalPolicy.status, "approved"),
      ),
    )
    .limit(1);
  return policy
    ? {
        id: policy.id,
        version: policy.version,
        jurisdictionCode: policy.jurisdictionCode,
        body: policy.body,
        bodySha256: policy.bodySha256,
      }
    : null;
}
