"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkAuthThrottle } from "@/domain/auth-throttle";
import { enrollShop, shopSignupInput } from "@/domain/shop-signup";
import {
  pilotOwnerEmail,
  shopSignupEnabledFor,
} from "@/lib/shop-signup-access";
import { AppError } from "@/lib/errors";
import { normalizeEmail } from "@/lib/normalize";
import { emailProvider } from "@/providers/email";
import { supabaseServer } from "@/server/auth/supabase";
import { getRequestMeta } from "@/server/request";
import { toActionError } from "./define";
import type { AuthFormState } from "./auth";

export type SignupFormState = AuthFormState & { ready?: boolean };

const accountInput = z.object({
  email: z.string().trim().max(254).pipe(z.email()),
  password: z.string().min(12).max(128),
});
function requireSignup(email: string) {
  if (!shopSignupEnabledFor(email))
    throw new AppError("NOT_ELIGIBLE", "New shop signup is not open yet.");
}

export async function sendPilotOwnerInvite(
  _: AuthFormState | null,
  form: FormData,
): Promise<AuthFormState> {
  const meta = await getRequestMeta();
  try {
    const email = pilotOwnerEmail(form.get("email"));
    if (!email)
      throw new AppError("NOT_ELIGIBLE", "This invitation is not available.");
    await checkAuthThrottle("invite", email, meta.ip);
    const signup = new URL("/sign-up", process.env.APP_BASE_URL!);
    signup.searchParams.set("email", email);
    await emailProvider().send({
      to: email,
      subject: "You’re invited to set up your shop on Shop Revenue",
      text: [
        "You’re invited to create your own shop on Shop Revenue.",
        "Choose your password and confirm your email, then enter your name and shop name:",
        signup.href,
        "Creating your login does not start a subscription or charge your card. You can review billing during setup.",
        "If you already created a login with this email, sign in and continue at /start.",
      ].join("\n\n"),
    });
    return {
      ok: true,
      message: `Invitation sent to ${email}. Check your inbox and spam folder.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: toActionError(error, meta, "sendPilotOwnerInvite").message,
    };
  }
}
export async function signUpOwner(
  _: SignupFormState | null,
  form: FormData,
): Promise<SignupFormState> {
  const meta = await getRequestMeta();
  try {
    const input = accountInput.safeParse({
      email: form.get("email"),
      password: form.get("password"),
    });
    if (!input.success)
      return {
        ok: false,
        message: "Enter a valid email and a password of 12–128 characters.",
      };
    const email = normalizeEmail(input.data.email);
    requireSignup(email);
    await checkAuthThrottle("signup", email, meta.ip);
    const base = new URL(process.env.APP_BASE_URL!);
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.signUp({
      email,
      password: input.data.password,
      options: {
        emailRedirectTo: new URL("/auth/callback?next=/start", base).href,
      },
    });
    if (error)
      throw new AppError(
        "PROVIDER_UNAVAILABLE",
        "Could not create your login. Try again or sign in if you already have an account.",
      );
    if (data.session)
      return {
        ok: true,
        message: "Your login is ready. Continue to set up your shop.",
        ready: true,
      };
    return {
      ok: true,
      message:
        "Check your email to confirm your account, then continue to set up your shop. If you already have an account, sign in.",
    };
  } catch (error) {
    return {
      ok: false,
      message: toActionError(error, meta, "signUpOwner").message,
    };
  }
}
export async function createMyShop(
  _: AuthFormState | null,
  form: FormData,
): Promise<AuthFormState> {
  const meta = await getRequestMeta();
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.getUser();
    const u = data.user;
    if (error || !u?.email || !u.email_confirmed_at)
      throw new AppError(
        "FORBIDDEN",
        "Sign in and confirm your email before creating your shop.",
      );
    requireSignup(u.email);
    await checkAuthThrottle("signup", u.email, meta.ip);
    const parsed = shopSignupInput.safeParse(Object.fromEntries(form));
    if (!parsed.success)
      return { ok: false, message: "Enter your name and shop name." };
    await enrollShop(
      { authSubject: u.id, email: u.email, emailVerified: true },
      parsed.data,
      meta,
    );
  } catch (error) {
    return {
      ok: false,
      message: toActionError(error, meta, "createMyShop").message,
    };
  }
  redirect("/app/settings/billing");
}
