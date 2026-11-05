"use server";
// S28 Settings: team. inviteStaff / resendInvite / removeStaff are Owner-only (D15).
import { eq } from "drizzle-orm";
import { z } from "zod";
import { business } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { deliverInvite } from "@/domain/invite-delivery";
import { audit, type RequestMeta } from "@/domain/records";
import { logger } from "@/lib/logger";
import {
  INVITE_DELIVERY_ACTION,
  inviteStaff,
  removeStaff,
  resendInvite,
  type InviteDelivery,
} from "@/domain/membership";
import { normalizeEmail, normalizePhone } from "@/lib/normalize";
import { defineShopAction } from "./define";

const businessName = (
  businessId: string,
  actor: Parameters<typeof withTenant>[1],
) =>
  withTenant(businessId, actor, async (tx) => {
    const [b] = await tx
      .select({ legal: business.legalName, dba: business.dba })
      .from(business)
      .where(eq(business.id, businessId));
    return b?.dba || b?.legal || "Your shop";
  });

// Stored for idempotent repeats: never the token. A repeat does not resend.
const delivered = (d: InviteDelivery) => ({
  membershipId: d.membershipId,
  message: "Invite already sent for this request.",
});

// Send, then record the outcome so the Team page can say whether it went out.
const sendAndRecord = async (
  d: InviteDelivery,
  session: { businessId: string; actor: Parameters<typeof withTenant>[1] },
  meta: RequestMeta,
) => {
  const outcome = await deliverInvite(
    d,
    await businessName(session.businessId, session.actor),
    meta.requestId,
  );
  try {
    await withTenant(session.businessId, session.actor, (tx) =>
      audit(tx, meta, {
        action: INVITE_DELIVERY_ACTION,
        targetType: "membership",
        targetId: d.membershipId,
        after: { status: outcome.status, channel: outcome.channel },
      }),
    );
  } catch (e) {
    logger.warn({
      event: "invite.delivery_record_failed",
      requestId: meta.requestId,
      membershipId: d.membershipId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return outcome;
};

const inviteInput = z.object({
  name: z.string().min(1).max(100),
  email: z.string().max(254).optional().or(z.literal("")),
  phone: z.string().max(40).optional().or(z.literal("")),
  role: z.enum(["staff", "technician"]).optional(),
});

export const inviteStaffAction = defineShopAction({
  name: "inviteStaff",
  input: inviteInput,
  ownerOnly: true,
  run: ({ tx, meta }, input) =>
    inviteStaff(tx, meta, {
      name: input.name,
      email: input.email ? normalizeEmail(input.email) : null,
      phoneE164: input.phone ? normalizePhone(input.phone) : null,
      role: input.role,
    }),
  persist: delivered,
  afterCommit: (d, session, meta) => sendAndRecord(d, session, meta),
});

export const resendInviteAction = defineShopAction({
  name: "resendInvite",
  input: z.object({ membershipId: z.uuid() }),
  ownerOnly: true,
  run: ({ tx, meta }, input) => resendInvite(tx, meta, input.membershipId),
  persist: delivered,
  afterCommit: (d, session, meta) => sendAndRecord(d, session, meta),
});

export const removeStaffAction = defineShopAction({
  name: "removeStaff",
  // Removing someone's access is always allowed.
  allowWhenUnpaid: true,
  input: z.object({ membershipId: z.uuid() }),
  ownerOnly: true,
  run: async ({ tx, meta }, input) => {
    await removeStaff(tx, meta, input.membershipId);
    return { removed: input.membershipId, message: "Removed." };
  },
});
