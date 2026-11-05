// Team access (D15, S28): Owner + Staff + Technician logins. inviteStaff, resendInvite,
// removeStaff are Owner-only; acceptInvite activates an invited membership for
// the signed-in person whose verified email or phone matches the invite.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { auditEvent, membership, user } from "@/db/schema";
import { resolveInvite, withTenant, type TenantTx } from "@/db/tenant";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { hashToken, isWellFormedToken, newToken } from "@/lib/tokens";
import { audit, recordActivity, type RequestMeta } from "./records";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type MembershipRole = "owner" | "staff" | "technician";

// The caller's role, read inside the transaction (never trusted from input).
export async function currentMemberRole(
  tx: TenantTx,
): Promise<MembershipRole | null> {
  if (tx.actor.type !== "user" || !tx.actor.id) return null;
  const [m] = await tx
    .select({ role: membership.role })
    .from(membership)
    .where(
      and(
        eq(membership.businessId, tx.businessId),
        eq(membership.userId, tx.actor.id),
        eq(membership.status, "active"),
      ),
    );
  return (m?.role as MembershipRole) ?? null;
}

export async function assertOwner(tx: TenantTx) {
  if ((await currentMemberRole(tx)) !== "owner")
    throw forbidden("Only the owner can do that.");
}

export const INVITE_DELIVERY_ACTION = "membership.invite_delivery";

// Latest delivery attempt per invited membership, from the audit trail written
// after each send. Invites with no recorded attempt are absent from the map.
export async function inviteDeliveryStatus(
  tx: TenantTx,
  membershipIds: string[],
): Promise<Map<string, "sent" | "failed">> {
  const out = new Map<string, "sent" | "failed">();
  if (!membershipIds.length) return out;
  const rows = await tx
    .select({ targetId: auditEvent.targetId, after: auditEvent.after })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.businessId, tx.businessId),
        eq(auditEvent.action, INVITE_DELIVERY_ACTION),
        inArray(auditEvent.targetId, membershipIds),
      ),
    )
    .orderBy(desc(auditEvent.occurredAt), desc(auditEvent.id));
  for (const r of rows) {
    if (!r.targetId || out.has(r.targetId)) continue;
    const status = (r.after as { status?: string } | null)?.status;
    out.set(r.targetId, status === "sent" ? "sent" : "failed");
  }
  return out;
}

export async function listTeam(tx: TenantTx) {
  return tx
    .select({
      id: membership.id,
      role: membership.role,
      status: membership.status,
      inviteName: membership.inviteName,
      inviteEmail: membership.inviteEmail,
      invitePhoneE164: membership.invitePhoneE164,
      inviteExpiresAt: membership.inviteExpiresAt,
      activatedAt: membership.activatedAt,
      userId: membership.userId,
      displayName: user.displayName,
      email: user.email,
      phoneE164: user.phoneE164,
    })
    .from(membership)
    .leftJoin(user, eq(user.id, membership.userId))
    .where(
      and(
        eq(membership.businessId, tx.businessId),
        inArray(membership.status, ["invited", "active"]),
      ),
    )
    .orderBy(membership.createdAt);
}

// Mirrors the cap in app.membership_guard (db/migrations/0050).
export const MAX_TEAM_SEATS = 10;

export type InviteDelivery = {
  membershipId: string;
  token: string;
  name: string;
  email: string | null;
  phoneE164: string | null;
};

export async function inviteStaff(
  tx: TenantTx,
  meta: RequestMeta,
  input: {
    name: string;
    email?: string | null;
    phoneE164?: string | null;
    role?: "staff" | "technician";
  },
): Promise<InviteDelivery> {
  await assertOwner(tx);
  if (!input.email && !input.phoneE164)
    throw new AppError("VALIDATION", "Add an email or a mobile number.");
  const role = input.role ?? "staff";
  if (role !== "staff" && role !== "technician")
    throw new AppError("VALIDATION", "Role must be staff or technician.");
  const [{ seats }] = await tx
    .select({ seats: sql<number>`count(*)::int` })
    .from(membership)
    .where(
      and(
        eq(membership.businessId, tx.businessId),
        inArray(membership.role, ["staff", "technician"]),
        inArray(membership.status, ["invited", "active"]),
      ),
    );
  if (seats >= MAX_TEAM_SEATS) {
    throw new AppError(
      "CONFLICT",
      `You can have up to ${MAX_TEAM_SEATS} team logins. Remove one to invite someone else.`,
    );
  }
  const invite = newToken();
  const [m] = await tx
    .insert(membership)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      role,
      status: "invited",
      inviteName: input.name,
      inviteEmail: input.email ?? null,
      invitePhoneE164: input.phoneE164 ?? null,
      inviteTokenHash: invite.hash,
      inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
    })
    .returning({ id: membership.id });
  await audit(tx, meta, {
    action: "membership.invited",
    targetType: "membership",
    targetId: m.id,
    after: { role },
  });
  await recordActivity(tx, {
    kind: "team.invited",
    subjectType: "membership",
    subjectId: m.id,
    summary:
      role === "technician"
        ? "Technician login invited"
        : "Staff login invited",
  });
  return {
    membershipId: m.id,
    token: invite.token,
    name: input.name,
    email: input.email ?? null,
    phoneE164: input.phoneE164 ?? null,
  };
}

// Rotates the token (the old link stops working) and extends the expiry.
export async function resendInvite(
  tx: TenantTx,
  meta: RequestMeta,
  membershipId: string,
): Promise<InviteDelivery> {
  const [m] = await tx
    .select()
    .from(membership)
    .where(
      and(
        eq(membership.businessId, tx.businessId),
        eq(membership.id, membershipId),
      ),
    );
  if (!m) throw notFound("That invite");
  if (m.role === "staff" || m.role === "technician") await assertOwner(tx);
  else if (tx.actor.type !== "internal") throw forbidden();
  if (m.status !== "invited")
    throw new AppError(
      "INVALID_TRANSITION",
      "That invite was already used or removed.",
    );
  const invite = newToken();
  await tx
    .update(membership)
    .set({
      inviteTokenHash: invite.hash,
      inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
    })
    .where(eq(membership.id, m.id));
  await audit(tx, meta, {
    action: "membership.invite_resent",
    targetType: "membership",
    targetId: m.id,
  });
  return {
    membershipId: m.id,
    token: invite.token,
    name: m.inviteName ?? "",
    email: m.inviteEmail,
    phoneE164: m.invitePhoneE164,
  };
}

export async function removeStaff(
  tx: TenantTx,
  meta: RequestMeta,
  membershipId: string,
) {
  // Owner request, or our support/admin resetting the login on the owner's behalf.
  if (tx.actor.type !== "internal") await assertOwner(tx);
  const [m] = await tx
    .select()
    .from(membership)
    .where(
      and(
        eq(membership.businessId, tx.businessId),
        eq(membership.id, membershipId),
      ),
    );
  if (!m) throw notFound("That team member");
  if (m.role === "owner")
    throw new AppError("FORBIDDEN", "The owner can't be removed.");
  if (m.status === "removed") return;
  await tx
    .update(membership)
    .set({ status: "removed" })
    .where(eq(membership.id, m.id));
  await audit(tx, meta, {
    action: "membership.removed",
    targetType: "membership",
    targetId: m.id,
    before: { status: m.status },
    after: { status: "removed" },
  });
  await recordActivity(tx, {
    kind: "team.removed",
    subjectType: "membership",
    subjectId: m.id,
    summary:
      m.role === "technician"
        ? "Technician login removed"
        : "Staff login removed",
  });
}

export type VerifiedIdentity = {
  authSubject: string;
  email: string | null;
  phoneE164: string | null;
  displayName: string;
};

// Same response for unknown, used, removed and expired tokens.
const INVITE_UNAVAILABLE = () =>
  new AppError(
    "NOT_FOUND",
    "This invite link is no longer valid. Ask the shop owner to send a new one.",
  );

export async function peekInvite(token: string) {
  if (!isWellFormedToken(token)) return null;
  const inv = await resolveInvite(hashToken(token));
  if (
    !inv ||
    (inv.inviteExpiresAt && inv.inviteExpiresAt.getTime() < Date.now())
  )
    return null;
  return inv;
}

export async function acceptInvite(
  meta: RequestMeta,
  token: string,
  who: VerifiedIdentity,
) {
  const inv = await peekInvite(token);
  if (!inv) throw INVITE_UNAVAILABLE();
  const emailMatches =
    !!inv.inviteEmail && !!who.email && inv.inviteEmail === who.email;
  const phoneMatches =
    !!inv.invitePhoneE164 &&
    !!who.phoneE164 &&
    inv.invitePhoneE164 === who.phoneE164;
  if (!emailMatches && !phoneMatches) {
    throw new AppError(
      "FORBIDDEN",
      "Sign in with the email or mobile number this invite was sent to.",
    );
  }
  return withTenant(
    inv.businessId,
    { type: "user", id: null, authSubject: who.authSubject },
    async (tx) => {
      let [u] = await tx
        .select()
        .from(user)
        .where(eq(user.authProviderId, who.authSubject));
      if (!u) {
        [u] = await tx
          .insert(user)
          .values({
            authProviderId: who.authSubject,
            email: who.email,
            phoneE164: who.phoneE164,
            displayName: who.displayName,
          })
          .returning();
      }
      if (u.status !== "active") throw forbidden("This login is deactivated.");
      const updated = await tx
        .update(membership)
        .set({ userId: u.id, status: "active" })
        .where(
          and(
            eq(membership.id, inv.membershipId),
            eq(membership.businessId, inv.businessId),
            eq(membership.status, "invited"),
            eq(membership.inviteTokenHash, hashToken(token)),
          ),
        )
        .returning({ id: membership.id });
      if (!updated.length) throw INVITE_UNAVAILABLE();
      const acting = Object.assign(Object.create(tx), {
        actor: { type: "user", id: u.id, authSubject: who.authSubject },
      }) as TenantTx;
      await audit(acting, meta, {
        action: "membership.activated",
        targetType: "membership",
        targetId: inv.membershipId,
        after: { role: inv.role, userId: u.id },
      });
      await recordActivity(acting, {
        kind: "team.joined",
        subjectType: "membership",
        subjectId: inv.membershipId,
        summary:
          inv.role === "owner"
            ? "Owner signed in for the first time"
            : inv.role === "technician"
              ? "Technician login accepted"
              : "Staff login accepted",
      });
      return { businessId: inv.businessId, userId: u.id, role: inv.role };
    },
  );
}
