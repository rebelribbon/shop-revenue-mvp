// Session -> membership -> active business (Section 9). The server verifies the
// Supabase session on every request and never trusts a business ID from the browser.
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { withAdmin } from "@/db/admin";
import { internalUser } from "@/db/schema";
import { resolveMemberships, type Actor } from "@/db/tenant";
import { findActiveSupportSession } from "@/domain/support";
import { safeEqual } from "@/lib/tokens";
import { supabaseServer } from "./supabase";

export type Identity = {
  authSubject: string;
  email: string | null;
  phoneE164: string | null;
  provider: string | null;
};

export const getIdentity = cache(async (): Promise<Identity | null> => {
  const supabase = await supabaseServer();
  // getUser() verifies the token with Supabase Auth (not just the cookie contents).
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const u = data.user;
  return {
    authSubject: u.id,
    email: u.email?.toLowerCase() ?? null,
    phoneE164: u.phone
      ? u.phone.startsWith("+")
        ? u.phone
        : `+${u.phone}`
      : null,
    provider: (u.app_metadata?.provider as string | undefined) ?? null,
  };
});

export type ShopSession = {
  businessId: string;
  actor: Actor;
  role: "owner" | "staff" | "technician" | "support";
  userId: string | null;
  supportSession: { id: string; expiresAt: Date; businessName: string } | null;
};

export const VIEW_AS_COOKIE = "view_as";
export const ACTIVE_BUSINESS_COOKIE = "active_business";

const sign = (v: string) => {
  const secret = process.env.SESSION_SIGNING_SECRET;
  if (!secret) throw new Error("SESSION_SIGNING_SECRET is not configured");
  return createHmac("sha256", secret).update(v).digest("base64url");
};
export const signValue = (v: string) => `${v}.${sign(v)}`;
export const verifySigned = (signed: string | undefined) => {
  if (!signed) return null;
  const i = signed.lastIndexOf(".");
  const v = signed.slice(0, i);
  return i > 0 && safeEqual(sign(v), signed.slice(i + 1)) ? v : null;
};

export const PASSWORD_RESET_COOKIE = "pw_reset";
const PASSWORD_RESET_WINDOW_MS = 15 * 60 * 1000;

// A successful recovery-link exchange (/auth/callback) grants a signed,
// httpOnly, 15-minute permission to choose a new password, bound to that user.
export async function grantPasswordReset(authSubject: string) {
  const jar = await cookies();
  jar.set(
    PASSWORD_RESET_COOKIE,
    signValue(`${authSubject}:${Date.now() + PASSWORD_RESET_WINDOW_MS}`),
    {
      httpOnly: true,
      secure: !["local", "test"].includes(process.env.APP_ENV ?? "local"),
      sameSite: "lax",
      path: "/",
      maxAge: PASSWORD_RESET_WINDOW_MS / 1000,
    },
  );
}

export async function hasPasswordResetGrant(
  identity: Identity | null,
): Promise<boolean> {
  if (!identity) return false;
  const grant = verifySigned(
    (await cookies()).get(PASSWORD_RESET_COOKIE)?.value,
  );
  if (!grant) return false;
  const [subject, until] = grant.split(":");
  return subject === identity.authSubject && Number(until) > Date.now();
}

export async function clearPasswordResetGrant() {
  (await cookies()).delete(PASSWORD_RESET_COOKIE);
}

export type SessionState =
  | { kind: "anonymous" }
  | { kind: "no_access"; identity: Identity }
  | { kind: "shop"; identity: Identity; session: ShopSession };

export const getSessionState = cache(async (): Promise<SessionState> => {
  const identity = await getIdentity();
  if (!identity) return { kind: "anonymous" };
  const jar = await cookies();

  // Support view-as: an internal user with a live, signed view-as session.
  const viewAs = verifySigned(jar.get(VIEW_AS_COOKIE)?.value);
  if (viewAs) {
    const internal = await getInternalUser();
    const s = internal
      ? await findActiveSupportSession(internal.id, viewAs)
      : null;
    if (internal && s) {
      return {
        kind: "shop",
        identity,
        session: {
          businessId: s.businessId,
          actor: {
            type: "support",
            id: internal.id,
            authSubject: identity.authSubject,
            supportSessionId: s.id,
          },
          role: "support",
          userId: null,
          supportSession: {
            id: s.id,
            expiresAt: s.expiresAt,
            businessName: s.businessName,
          },
        },
      };
    }
  }

  // Removed or suspended memberships, deactivated users and non-active businesses
  // never resolve, which ends access on the next request.
  const usable = (await resolveMemberships(identity.authSubject)).filter(
    (m) =>
      m.status === "active" &&
      m.userStatus === "active" &&
      m.businessStatus === "active",
  );
  if (!usable.length) return { kind: "no_access", identity };
  // One membership is the MVP norm. With several, the choice is a signed cookie
  // that is re-checked against live memberships on every request.
  const chosen = verifySigned(jar.get(ACTIVE_BUSINESS_COOKIE)?.value);
  const m = usable.find((x) => x.businessId === chosen) ?? usable[0];
  return {
    kind: "shop",
    identity,
    session: {
      businessId: m.businessId,
      actor: { type: "user", id: m.userId, authSubject: identity.authSubject },
      role: m.role as "owner" | "staff" | "technician",
      userId: m.userId,
      supportSession: null,
    },
  };
});

export type InternalUser = {
  id: string;
  email: string;
  displayName: string;
  role: "support" | "admin";
};

// /admin: Google Workspace SSO restricted to our domain plus an allowlist
// (internal_user, active). Locally and in tests, where Google SSO is not
// available, an email sign-in by an allowlisted address is accepted instead;
// any other environment requires the google provider.
export const getInternalUser = cache(async (): Promise<InternalUser | null> => {
  const identity = await getIdentity();
  if (!identity?.email) return null;
  const env = process.env.APP_ENV ?? "local";
  const domain = process.env.ADMIN_ALLOWED_EMAIL_DOMAIN;
  // Belt and braces: the local path also requires Supabase Auth itself to be local,
  // so a misconfigured APP_ENV on a hosted deployment cannot enable it.
  const authHost = new URL(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid",
  ).hostname;
  const localAuth =
    (env === "local" || env === "test") &&
    ["127.0.0.1", "localhost"].includes(authHost);
  if (!localAuth) {
    if (identity.provider !== "google") return null;
    if (!domain || !identity.email.endsWith(`@${domain}`)) return null;
  }
  return withAdmin(null, async (tx) => {
    const [u] = await tx
      .select()
      .from(internalUser)
      .where(eq(internalUser.email, identity.email!));
    if (!u || !u.active) return null;
    if (u.authProviderId && u.authProviderId !== identity.authSubject)
      return null;
    if (!u.authProviderId) {
      await tx
        .update(internalUser)
        .set({ authProviderId: identity.authSubject })
        .where(eq(internalUser.id, u.id));
    }
    return {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      role: u.role as "support" | "admin",
    };
  });
});
