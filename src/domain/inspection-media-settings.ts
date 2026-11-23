import { sql } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { assertOwner } from "./membership";
import { audit, type RequestMeta } from "./records";

export type InspectionMediaRequirements = {
  photos: boolean;
  videos: boolean;
};

export async function getInspectionMediaRequirements(
  tx: TenantTx,
): Promise<InspectionMediaRequirements> {
  const result = await tx.execute(
    sql`SELECT inspection_media_requirements AS requirements FROM app.business WHERE id = ${tx.businessId}`,
  );
  const saved = result.rows[0]?.requirements as
    Partial<InspectionMediaRequirements> | undefined;
  return { photos: saved?.photos === true, videos: saved?.videos === true };
}

export async function setInspectionMediaRequirements(
  tx: TenantTx,
  meta: RequestMeta,
  next: InspectionMediaRequirements,
) {
  await assertOwner(tx);
  const before = await getInspectionMediaRequirements(tx);
  await tx.execute(
    sql`UPDATE app.business SET inspection_media_requirements = ${JSON.stringify(next)}::jsonb, updated_at = now() WHERE id = ${tx.businessId}`,
  );
  await audit(tx, meta, {
    action: "business.inspection_media_requirements_updated",
    targetType: "business",
    targetId: tx.businessId,
    before,
    after: next,
  });
  return next;
}
