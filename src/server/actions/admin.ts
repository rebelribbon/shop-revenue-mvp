"use server";
// Internal admin actions (Section 10: createBusiness, startSupportSession,
// endSupportSession, replayWebhook, approveLegalPolicy ...). All require an
// active internal user; admin-only ones require role admin; all are audited.
import { assertSessionAssurance } from "../auth/assurance";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withAdminTenant } from "@/db/admin";
import { createBusiness } from "@/domain/business";
import { deliverInvite } from "@/domain/invite-delivery";
import {
  approvePolicy,
  createPolicyDraft,
  POLICY_KINDS,
  retirePolicy,
  updatePolicyDraft,
} from "@/domain/legal-policy";
import { removeStaff, resendInvite } from "@/domain/membership";
import { startSupportSession } from "@/domain/support";
import { replayWebhookEvent } from "@/domain/webhooks";
import { setShopComped } from "@/domain/billing";
import { AppError } from "@/lib/errors";
import { normalizeEmail, normalizePhone } from "@/lib/normalize";
import { getInternalUser, signValue, VIEW_AS_COOKIE } from "../auth/session";
import { AUTH_COOKIE_OPTIONS, supabaseServer } from "../auth/supabase";
import { getRequestMeta } from "../request";
import { toActionError, type ActionResult } from "./define";

function defineAdminAction<S extends z.ZodObject, R>(cfg: {
  name: string;
  role?: "admin";
  input: S;
  run: (
    actor: { internalUserId: string },
    meta: Awaited<ReturnType<typeof getRequestMeta>>,
    input: z.infer<S>,
  ) => Promise<R>;
}) {
  const schema = cfg.input
    .extend({ clientRequestId: z.uuid().optional() })
    .strict();
  return async (raw: unknown): Promise<ActionResult<R>> => {
    const meta = await getRequestMeta();
    try {
      const me = await getInternalUser();
      if (!me)
        throw new AppError("FORBIDDEN", "Please sign in to the admin console.");
      await assertSessionAssurance();
      if (cfg.role === "admin" && me.role !== "admin")
        throw new AppError("FORBIDDEN", "Admins only.");
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        throw new AppError("VALIDATION", "Please check the fields.", {
          fields: Object.fromEntries(
            parsed.error.issues.map((i) => [i.path.join("."), i.message]),
          ),
        });
      }
      const { clientRequestId: _ignored, ...input } =
        parsed.data as z.infer<S> & { clientRequestId?: string };
      void _ignored;
      return {
        ok: true,
        data: await cfg.run(
          { internalUserId: me.id },
          meta,
          input as z.infer<S>,
        ),
      };
    } catch (err) {
      return { ok: false, error: toActionError(err, meta, cfg.name) };
    }
  };
}

export const createBusinessAction = defineAdminAction({
  name: "createBusiness",
  role: "admin",
  input: z.object({
    legalName: z.string().min(1).max(200),
    dba: z.string().max(200).optional(),
    ownerName: z.string().min(1).max(100),
    ownerEmail: z.string().max(254).optional(),
    ownerPhone: z.string().max(40).optional(),
  }),
  run: async (actor, meta, i) => {
    const created = await createBusiness(actor, meta, {
      legalName: i.legalName,
      dba: i.dba || null,
      owner: {
        name: i.ownerName,
        email: i.ownerEmail ? normalizeEmail(i.ownerEmail) : null,
        phoneE164: i.ownerPhone ? normalizePhone(i.ownerPhone) : null,
      },
    });
    const delivery = await deliverInvite(
      {
        membershipId: created.ownerMembershipId,
        token: created.inviteToken,
        name: i.ownerName,
        email: i.ownerEmail ? normalizeEmail(i.ownerEmail) : null,
        phoneE164: i.ownerPhone ? normalizePhone(i.ownerPhone) : null,
      },
      i.dba || i.legalName,
      meta.requestId,
    );
    return {
      businessId: created.businessId,
      invite: delivery.status,
      message:
        delivery.status === "sent"
          ? "Created. Owner invite sent."
          : "Created, but the owner invite was NOT sent. Resend it from the tenant page.",
    };
  },
});

export const resendOwnerInviteAction = defineAdminAction({
  name: "resendInvite",
  input: z.object({
    businessId: z.uuid(),
    membershipId: z.uuid(),
    businessName: z.string().max(200),
  }),
  run: async (actor, meta, i) => {
    const d = await withAdminTenant(i.businessId, actor, (tx) =>
      resendInvite(tx, meta, i.membershipId),
    );
    return deliverInvite(d, i.businessName, meta.requestId);
  },
});

// "Invite/remove the Staff login — Internal: can reset on owner request" (Section 2).
export const resetStaffAction = defineAdminAction({
  name: "removeStaff",
  input: z.object({ businessId: z.uuid(), membershipId: z.uuid() }),
  run: async (actor, meta, i) => {
    await withAdminTenant(i.businessId, actor, (tx) =>
      removeStaff(tx, meta, i.membershipId),
    );
    return { removed: i.membershipId, message: "Staff login removed." };
  },
});

export const startViewAsAction = defineAdminAction({
  name: "startSupportSession",
  input: z.object({ businessId: z.uuid(), reason: z.string().max(500) }),
  run: async (actor, meta, i) => {
    const s = await startSupportSession(actor, meta, {
      businessId: i.businessId,
      reason: i.reason,
    });
    (await cookies()).set(VIEW_AS_COOKIE, signValue(s.id), {
      ...AUTH_COOKIE_OPTIONS,
      maxAge: 60 * 60,
    });
    return { sessionId: s.id, redirectTo: "/app" };
  },
});

export const createPolicyDraftAction = defineAdminAction({
  name: "createLegalPolicyDraft",
  role: "admin",
  input: z.object({
    jurisdictionCode: z.string().regex(/^[A-Z]{2}-[A-Z]{2}$/),
    kind: z.enum(POLICY_KINDS),
    body: z.string().min(1).max(20_000),
  }),
  run: async (actor, meta, i) => (await createPolicyDraft(actor, meta, i)).id,
});

export const updatePolicyDraftAction = defineAdminAction({
  name: "updateLegalPolicyDraft",
  role: "admin",
  input: z.object({ policyId: z.uuid(), body: z.string().min(1).max(20_000) }),
  run: async (actor, meta, i) =>
    (await updatePolicyDraft(actor, meta, i.policyId, i.body)).id,
});

export const approvePolicyAction = defineAdminAction({
  name: "approveLegalPolicy",
  role: "admin",
  input: z.object({
    policyId: z.uuid(),
    approvalReference: z.string().min(1).max(200),
  }),
  run: async (actor, meta, i) => (await approvePolicy(actor, meta, i)).id,
});

export const retirePolicyAction = defineAdminAction({
  name: "retireLegalPolicy",
  role: "admin",
  input: z.object({ policyId: z.uuid() }),
  run: async (actor, meta, i) =>
    (await retirePolicy(actor, meta, i.policyId)).id,
});

export const replayWebhookAction = defineAdminAction({
  name: "replayWebhook",
  role: "admin",
  input: z.object({ eventId: z.uuid() }),
  run: (actor, meta, i) => replayWebhookEvent(actor, meta, i.eventId),
});

// Google Workspace SSO for /admin (Section 2). BLOCKED until the Google OAuth
// client and the hosted Supabase project are configured.
export async function signInWithGoogle() {
  const supabase = await supabaseServer();
  const base = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${base}/auth/callback?next=/admin`,
      queryParams: process.env.ADMIN_ALLOWED_EMAIL_DOMAIN
        ? {
            hd: process.env.ADMIN_ALLOWED_EMAIL_DOMAIN,
            prompt: "select_account",
          }
        : undefined,
    },
  });
  if (error || !data.url) redirect("/admin/sign-in?error=google");
  redirect(data.url);
}

export const setShopCompedAction = defineAdminAction({
  name: "setShopComped",
  role: "admin",
  input: z.object({
    businessId: z.uuid(),
    comped: z.enum(["true", "false"]),
    reason: z.string().trim().max(500).optional(),
  }),
  run: async (actor, meta, i) => {
    if (i.comped === "true" && (i.reason ?? "").length < 3)
      throw new AppError("VALIDATION", "Say why this shop is free.", {
        fields: { reason: "Required" },
      });
    const r = await setShopComped(actor, meta, {
      businessId: i.businessId,
      comped: i.comped === "true",
      reason: i.reason ?? "",
    });
    return {
      message: r.comped
        ? "This shop now has free access."
        : "This shop is billed normally again.",
    };
  },
});
