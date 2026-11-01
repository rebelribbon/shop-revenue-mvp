"use server";
// S28 Settings: team. inviteStaff / resendInvite / removeStaff are Owner-only (D15).
import { eq } from "drizzle-orm";
import { z } from "zod";
import { business } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { deliverInvite } from "@/domain/invite-delivery";
import {
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

const inviteInput = z.object({
  name: z.string().min(1).max(100),
  email: z.string().max(254).optional().or(z.literal("")),
  phone: z.string().max(40).optional().or(z.literal("")),
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
    }),
  persist: delivered,
  afterCommit: async (d, session, meta) =>
    deliverInvite(
      d,
      await businessName(session.businessId, session.actor),
      meta.requestId,
    ),
});

export const resendInviteAction = defineShopAction({
  name: "resendInvite",
  input: z.object({ membershipId: z.uuid() }),
  ownerOnly: true,
  run: ({ tx, meta }, input) => resendInvite(tx, meta, input.membershipId),
  persist: delivered,
  afterCommit: async (d, session, meta) =>
    deliverInvite(
      d,
      await businessName(session.businessId, session.actor),
      meta.requestId,
    ),
});

export const removeStaffAction = defineShopAction({
  name: "removeStaff",
  input: z.object({ membershipId: z.uuid() }),
  ownerOnly: true,
  run: async ({ tx, meta }, input) => {
    await removeStaff(tx, meta, input.membershipId);
    return { removed: input.membershipId, message: "Removed." };
  },
});
