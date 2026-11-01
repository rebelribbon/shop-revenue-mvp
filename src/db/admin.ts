// Internal admin database access (/admin and admin scripts). Connects as
// admin_user, which is still subject to tenant RLS on tenant tables: platform
// work runs with no tenant context, tenant work through withAdminTenant().
import type { Tx, TenantTx } from "./tenant";
import { runInContext, withTenant } from "./tenant";

export type InternalActor = {
  internalUserId: string;
  supportSessionId?: string | null;
};

export async function withAdmin<T>(
  actor: InternalActor | null,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return runInContext(
    null,
    { type: "internal", id: actor?.internalUserId ?? null },
    fn,
    { role: "admin" },
  );
}

export async function withAdminTenant<T>(
  businessId: string,
  actor: InternalActor,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return withTenant(
    businessId,
    { type: "internal", id: actor.internalUserId },
    fn,
    { role: "admin" },
  );
}
