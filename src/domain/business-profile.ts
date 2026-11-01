import { AppError } from "@/lib/errors";
import { assertOwner } from "./membership";
import { z } from "zod";
import { businessTypes, type BusinessType } from "@/lib/business-types";
import { eq } from "drizzle-orm";
import { business } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import type { RequestMeta } from "./records";
import { audit, recordActivity } from "./records";

export async function getBusinessProfile(tx: TenantTx) {
  const [row] = await tx
    .select()
    .from(business)
    .where(eq(business.id, tx.businessId));
  return row;
}

export async function updateBusinessProfile(
  tx: TenantTx,
  meta: RequestMeta,
  input: {
    legalName: string;
    businessType?: BusinessType;
    dba?: string | null;
    phoneE164?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    region?: string | null;
    postalCode?: string | null;
    timezone: string;
    taxRateBps?: number;
    laborSellRateCents?: number;
    laborCostRateCents?: number;
    partsTaxableDefault?: boolean;
    laborTaxableDefault?: boolean;
    // The owner ticked "I chose this tax rate". Required whenever the tax
    // settings are saved for the first time or changed.
    taxConfirmed?: boolean;
  },
) {
  await assertOwner(tx);
  const [before] = await tx
    .select()
    .from(business)
    .where(eq(business.id, tx.businessId));
  const changed = <T>(next: T | undefined, prev: T | undefined) =>
    next !== undefined && next !== prev;
  const taxSubmitted = input.taxRateBps !== undefined;
  const taxChanged =
    changed(input.taxRateBps, before?.taxRateBps) ||
    changed(input.partsTaxableDefault, before?.partsTaxableDefault) ||
    changed(input.laborTaxableDefault, before?.laborTaxableDefault);
  const needsConfirm =
    taxSubmitted && (taxChanged || !before?.taxRateConfirmedAt);
  if (needsConfirm && !input.taxConfirmed)
    throw new AppError(
      "VALIDATION",
      "Tick the box to confirm you chose this tax rate.",
      {
        fields: {
          taxConfirmed: "Confirm you chose this tax rate before saving.",
        },
      },
    );
  const confirmNow = needsConfirm && input.taxConfirmed === true;
  const [row] = await tx
    .update(business)
    .set({
      ...(input.businessType
        ? {
            businessType: z.enum(businessTypes).parse(input.businessType),
            businessTypeSelected: true,
          }
        : {}),
      legalName: input.legalName,
      dba: input.dba || null,
      phoneE164: input.phoneE164 || null,
      addressLine1: input.addressLine1 || null,
      addressLine2: input.addressLine2 || null,
      city: input.city || null,
      region: input.region || null,
      postalCode: input.postalCode || null,
      timezone: input.timezone,
      taxRateBps: input.taxRateBps,
      laborSellRateCents: input.laborSellRateCents,
      laborCostRateCents: input.laborCostRateCents,
      partsTaxableDefault: input.partsTaxableDefault,
      laborTaxableDefault: input.laborTaxableDefault,
      ...(confirmNow
        ? {
            taxRateConfirmedAt: new Date(),
            taxRateConfirmedBy: tx.actor.type === "user" ? tx.actor.id : null,
          }
        : {}),
    })
    .where(eq(business.id, tx.businessId))
    .returning();
  await audit(tx, meta, {
    action: "business.profile_updated",
    targetType: "business",
    targetId: tx.businessId,
    before: before
      ? {
          legalName: before.legalName,
          dba: before.dba,
          timezone: before.timezone,
          businessType: before.businessType,
          taxRateBps: before.taxRateBps,
          laborSellRateCents: before.laborSellRateCents,
          laborCostRateCents: before.laborCostRateCents,
          partsTaxableDefault: before.partsTaxableDefault,
          laborTaxableDefault: before.laborTaxableDefault,
        }
      : null,
    after: {
      legalName: row.legalName,
      dba: row.dba,
      timezone: row.timezone,
      businessType: row.businessType,
      taxRateBps: row.taxRateBps,
      laborSellRateCents: row.laborSellRateCents,
      laborCostRateCents: row.laborCostRateCents,
      partsTaxableDefault: row.partsTaxableDefault,
      laborTaxableDefault: row.laborTaxableDefault,
      ...(confirmNow
        ? {
            taxRateConfirmedAt: row.taxRateConfirmedAt,
            taxRateConfirmedBy: row.taxRateConfirmedBy,
          }
        : {}),
    },
  });
  await recordActivity(tx, {
    kind: "business.updated",
    subjectType: "business",
    subjectId: tx.businessId,
    summary: "Business profile updated",
  });
  return row;
}
