"use server";
import { safeErrorDiagnostic } from "@/lib/errors";
import { redirect } from "next/navigation";
import { z } from "zod";
import { acceptInvite, peekInvite } from "@/domain/membership";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { maskEmail, normalizeEmail } from "@/lib/normalize";
import { safeNext } from "@/lib/safe-next";
import { checkAuthThrottle } from "@/domain/auth-throttle";
import {
  authServiceUnavailable,
  signInFailureMessage,
} from "@/lib/auth-errors";
import { getRequestMeta } from "../request";
import {
  clearPasswordResetGrant,
  getIdentity,
  hasPasswordResetGrant,
} from "../auth/session";
import { supabaseAdmin, supabaseServer } from "../auth/supabase";

export type AuthFormState = { ok: boolean; message: string };

const base = () => (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
const RESET_SENT =
  "If that email can sign in, we sent password reset instructions.";

const passwordInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  next: z.string().optional(),
});

export async function signInWithPassword(
  _: AuthFormState | null,
  form: FormData,
): Promise<AuthFormState> {
  const meta = await getRequestMeta();
  const parsed = passwordInput.safeParse({
    email: String(form.get("email") ?? "")
      .trim()
      .toLowerCase(),
    password: String(form.get("password") ?? ""),
    next: String(form.get("next") ?? ""),
  });
  if (!parsed.success)
    return { ok: false, message: "Enter your email and password." };

  try {
    await checkAuthThrottle("sign_in", parsed.data.email, meta.ip);
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof AppError ? e.message : "Sign-in is unavailable right now.",
    };
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  logger.info({
    event: "auth.password_sign_in",
    requestId: meta.requestId,
    email: maskEmail(parsed.data.email),
    accepted: !error,
    providerStatus: error?.status,
    providerCode: error?.code,
  });
  if (error) return { ok: false, message: signInFailureMessage(error) };
  redirect(safeNext(parsed.data.next));
}

export async function requestPasswordReset(
  _: AuthFormState | null,
  form: FormData,
): Promise<AuthFormState> {
  const meta = await getRequestMeta();
  let email: string;
  try {
    email = normalizeEmail(String(form.get("email") ?? ""));
  } catch {
    return { ok: false, message: "Enter a valid email address." };
  }

  try {
    await checkAuthThrottle("reset", email, meta.ip);
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof AppError
          ? e.message
          : "Password reset is unavailable right now.",
    };
  }
  const supabase = await supabaseServer();
  const next = "/reset-password";
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${base()}/auth/callback?next=${encodeURIComponent(next)}`,
  });
  logger.info({
    event: "auth.password_reset_requested",
    requestId: meta.requestId,
    email: maskEmail(email),
    accepted: !error,
    providerStatus: error?.status,
    providerCode: error?.code,
  });
  if (error && authServiceUnavailable(error)) {
    return {
      ok: false,
      message:
        "Password reset email is unavailable right now. Please try again shortly.",
    };
  }
  return { ok: true, message: RESET_SENT };
}

const newPasswordInput = z.object({
  password: z.string().min(8, "Use at least 8 characters."),
  confirmPassword: z.string(),
  next: z.string().optional(),
});

export async function updatePassword(
  _: AuthFormState | null,
  form: FormData,
): Promise<AuthFormState> {
  const parsed = newPasswordInput.safeParse({
    password: String(form.get("password") ?? ""),
    confirmPassword: String(form.get("confirmPassword") ?? ""),
    next: String(form.get("next") ?? ""),
  });
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Choose a valid password.",
    };
  if (parsed.data.password !== parsed.data.confirmPassword)
    return { ok: false, message: "Passwords do not match." };

  const identity = await getIdentity();
  if (!(await hasPasswordResetGrant(identity))) {
    return {
      ok: false,
      message:
        "That password reset link expired or was already used. Request a new one.",
    };
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error)
    return {
      ok: false,
      message:
        "We could not update your password. Request a new reset link and try again.",
    };
  const { error: revokeError } = await supabase.auth.signOut({
    scope: "others",
  });
  await clearPasswordResetGrant();
  if (revokeError) {
    logger.warn({
      event: "auth.other_sessions_revocation_failed",
      ...safeErrorDiagnostic(revokeError),
    });
    return {
      ok: false,
      message:
        "Your password changed, but other sessions could not be signed out. Contact support before continuing.",
    };
  }
  redirect(safeNext(parsed.data.next));
}

// Invite path. Email invites use Supabase recovery email so a new invitee proves
// control of the invited address and chooses a password before accepting access.
export async function startInviteSignIn(
  _: AuthFormState | null,
  form: FormData,
): Promise<AuthFormState> {
  const meta = await getRequestMeta();
  const token = String(form.get("token") ?? "");
  const invite = await peekInvite(token);
  if (!invite)
    return {
      ok: false,
      message:
        "This invite link is no longer valid. Ask the shop owner to send a new one.",
    };
  if (!invite.inviteEmail) {
    return {
      ok: false,
      message:
        "This MVP requires an email invitation. Ask the shop owner to send a new invite by email.",
    };
  }

  try {
    await checkAuthThrottle("invite", invite.inviteEmail, meta.ip);
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof AppError
          ? e.message
          : "Account setup is unavailable right now.",
    };
  }
  try {
    const admin = supabaseAdmin();
    const { error } = await admin.auth.admin.createUser({
      email: invite.inviteEmail,
      email_confirm: true,
    });
    if (error && error.code !== "email_exists" && error.status !== 422) {
      throw new AppError(
        "PROVIDER_UNAVAILABLE",
        "Sign-in is unavailable right now.",
      );
    }
  } catch (e) {
    logger.warn({
      event: "invite.auth_user_failed",
      requestId: meta.requestId,
      ...safeErrorDiagnostic(e),
    });
    return {
      ok: false,
      message:
        "Account setup is unavailable right now. Please try again shortly.",
    };
  }

  const afterReset = `/invite/${token}`;
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.resetPasswordForEmail(
    invite.inviteEmail,
    {
      redirectTo: `${base()}/auth/callback?next=${encodeURIComponent(`/reset-password?next=${encodeURIComponent(afterReset)}`)}`,
    },
  );
  if (error)
    return {
      ok: false,
      message:
        "We couldn't send the account setup email. Please try again shortly.",
    };
  return {
    ok: true,
    message: `We emailed account setup instructions to ${maskEmail(invite.inviteEmail)}.`,
  };
}

export async function acceptInviteAction(
  _: AuthFormState | null,
  form: FormData,
): Promise<AuthFormState> {
  const meta = await getRequestMeta();
  const identity = await getIdentity();
  if (!identity) return { ok: false, message: "Please sign in first." };
  const token = String(form.get("token") ?? "");
  const displayName = String(form.get("displayName") ?? "")
    .trim()
    .slice(0, 100);
  if (!displayName) return { ok: false, message: "Enter your name." };
  try {
    await acceptInvite(meta, token, {
      authSubject: identity.authSubject,
      email: identity.email,
      phoneE164: identity.phoneE164,
      displayName,
    });
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof AppError
          ? e.message
          : `Something went wrong (reference ${meta.requestId}).`,
    };
  }
  redirect("/app");
}
