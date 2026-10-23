// Delivers an invite link after the inviting transaction commits (Section 10:
// external calls never run inside a transaction). The plaintext token exists
// only here and in the link; failure is reported honestly and the owner can
// "Resend invite", which rotates the token.
import { emailProvider } from "@/providers/email";
import { messagingProvider } from "@/providers/messaging";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { InviteDelivery } from "./membership";

export type DeliveryOutcome = { membershipId: string; channel: "email" | "sms"; status: "sent" | "failed"; message: string };

export function inviteLink(token: string) {
  const base = process.env.APP_BASE_URL;
  if (!base) throw new AppError("PROVIDER_UNAVAILABLE", "APP_BASE_URL is not configured.");
  return `${base.replace(/\/$/, "")}/invite/${token}`;
}

export async function deliverInvite(d: InviteDelivery, businessName: string, requestId: string): Promise<DeliveryOutcome> {
  const link = inviteLink(d.token);
  const channel = d.email ? "email" : "sms";
  try {
    if (d.email) {
      await emailProvider().send({
        to: d.email,
        subject: `You're invited to ${businessName}`,
        text: `Hi ${d.name || "there"},\n\n${businessName} invited you to sign in.\n\nAccept the invite: ${link}\n\nThis link works for 7 days.`,
        metadata: { kind: "invite", membershipId: d.membershipId },
      });
    } else if (d.phoneE164) {
      await messagingProvider().sendSystemSms({
        to: d.phoneE164,
        body: `${businessName} invited you to sign in: ${link}`,
        purpose: "system",
      });
    }
    logger.info({ event: "invite.delivered", requestId, membershipId: d.membershipId, channel });
    return { membershipId: d.membershipId, channel, status: "sent", message: `Invite sent by ${channel === "email" ? "email" : "text"}.` };
  } catch (e) {
    logger.warn({ event: "invite.delivery_failed", requestId, membershipId: d.membershipId, channel, err: (e as Error).message });
    return { membershipId: d.membershipId, channel, status: "failed", message: "The invite was saved but could not be sent. Use Resend invite." };
  }
}
