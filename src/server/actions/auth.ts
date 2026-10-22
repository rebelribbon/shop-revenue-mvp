"use server";
// S30 Sign in / accept invite. Email magic link or SMS code (Supabase Auth,
// sign-up closed: shouldCreateUser false). Responses are identical whether or
// not the address has access, so the form cannot be used to probe accounts.
import { redirect } from "next/navigation";
import { z } from "zod";
import { acceptInvite, peekInvite } from "@/domain/membership";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { maskEmail, maskPhone, normalizeEmail, normalizePhone } from "@/lib/normalize";
import { safeNext } from "@/lib/safe-next";
import { getRequestMeta } from "../request";
import { getIdentity } from "../auth/session";
import { supabaseAdmin, supabaseServer } from "../auth/supabase";

export type AuthFormState = { ok: boolean; message: string; step?: "code"; phone?: string };

const base = () => (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");
const SENT = "If that address has access, we sent a sign-in link. It works once, in this browser.";

export async function sendEmailLink(_: AuthFormState | null, form: FormData): Promise<AuthFormState> {
  const meta = await getRequestMeta();
  let email: string;
  try {
    email = normalizeEmail(String(form.get("email") ?? ""));
  } catch (e) {
    return { ok: false, message: (e as AppError).message };
  }
  const next = safeNext(String(form.get("next") ?? ""));
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${base()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  logger.info({ event: "auth.email_link_requested", requestId: meta.requestId, email: maskEmail(email), accepted: !error });
  if (error && error.status && error.status >= 500) return { ok: false, message: "Sign-in email is unavailable right now. Try the SMS code instead." };
  return { ok: true, message: SENT };
}

export async function sendSmsCode(_: AuthFormState | null, form: FormData): Promise<AuthFormState> {
  const meta = await getRequestMeta();
  let phone: string;
  try {
    phone = normalizePhone(String(form.get("phone") ?? ""));
  } catch (e) {
    return { ok: false, message: (e as AppError).message };
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } });
  logger.info({ event: "auth.sms_code_requested", requestId: meta.requestId, phone: maskPhone(phone), accepted: !error });
  if (error && error.status && error.status >= 500) return { ok: false, message: "Texting is unavailable right now. Use the email link instead." };
  return { ok: true, step: "code", phone, message: "If that number has access, we texted a 6-digit code." };
}

const codeInput = z.object({ phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/), code: z.string().regex(/^[0-9]{6}$/), next: z.string().optional() });

export async function verifySmsCode(_: AuthFormState | null, form: FormData): Promise<AuthFormState> {
  const parsed = codeInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, step: "code", phone: String(form.get("phone") ?? ""), message: "Enter the 6-digit code." };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ phone: parsed.data.phone, token: parsed.data.code, type: "sms" });
  if (error) return { ok: false, step: "code", phone: parsed.data.phone, message: "That code didn't work. Check it or request a new one." };
  redirect(safeNext(parsed.data.next));
}

// Invite path: the invitee proves control of the invited email or phone. The auth
// user is created here if new (sign-up is otherwise closed), then a normal
// sign-in link or code is sent to the invited address only.
export async function startInviteSignIn(_: AuthFormState | null, form: FormData): Promise<AuthFormState> {
  const meta = await getRequestMeta();
  const token = String(form.get("token") ?? "");
  const invite = await peekInvite(token);
  if (!invite) return { ok: false, message: "This invite link is no longer valid. Ask the shop owner to send a new one." };
  try {
    const admin = supabaseAdmin();
    const attrs = invite.inviteEmail
      ? { email: invite.inviteEmail, email_confirm: true }
      : { phone: invite.invitePhoneE164!, phone_confirm: true };
    const { error } = await admin.auth.admin.createUser(attrs);
    if (error && error.code !== "email_exists" && error.code !== "phone_exists" && error.status !== 422) {
      throw new AppError("PROVIDER_UNAVAILABLE", "Sign-in is unavailable right now.");
    }
  } catch (e) {
    logger.warn({ event: "invite.auth_user_failed", requestId: meta.requestId, err: (e as Error).message });
    return { ok: false, message: "Sign-in is unavailable right now. Please try again shortly." };
  }
  const next = `/invite/${token}`;
  const supabase = await supabaseServer();
  if (invite.inviteEmail) {
    const { error } = await supabase.auth.signInWithOtp({
      email: invite.inviteEmail,
      options: { shouldCreateUser: false, emailRedirectTo: `${base()}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) return { ok: false, message: "We couldn't send the sign-in email. Please try again shortly." };
    return { ok: true, message: `We emailed a sign-in link to ${maskEmail(invite.inviteEmail)}. Open it in this browser.` };
  }
  const { error } = await supabase.auth.signInWithOtp({ phone: invite.invitePhoneE164!, options: { shouldCreateUser: false } });
  if (error) return { ok: false, message: "We couldn't text a code. Please try again shortly." };
  return { ok: true, step: "code", phone: invite.invitePhoneE164!, message: `We texted a code to ${maskPhone(invite.invitePhoneE164)}.` };
}

// acceptInvite (Section 10): the signed-in invitee activates the membership.
export async function acceptInviteAction(_: AuthFormState | null, form: FormData): Promise<AuthFormState> {
  const meta = await getRequestMeta();
  const identity = await getIdentity();
  if (!identity) return { ok: false, message: "Please sign in first." };
  const token = String(form.get("token") ?? "");
  const displayName = String(form.get("displayName") ?? "").trim().slice(0, 100);
  if (!displayName) return { ok: false, message: "Enter your name." };
  try {
    await acceptInvite(meta, token, { authSubject: identity.authSubject, email: identity.email, phoneE164: identity.phoneE164, displayName });
  } catch (e) {
    return { ok: false, message: e instanceof AppError ? e.message : `Something went wrong (reference ${meta.requestId}).` };
  }
  redirect("/app");
}
