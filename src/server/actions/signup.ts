"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkAuthThrottle } from "@/domain/auth-throttle";
import { enrollShop, shopSignupInput } from "@/domain/shop-signup";
import { publicSignupEnabled } from "@/lib/billing";
import { AppError } from "@/lib/errors";
import { normalizeEmail } from "@/lib/normalize";
import { supabaseServer } from "@/server/auth/supabase";
import { getRequestMeta } from "@/server/request";
import { toActionError } from "./define";
import type { AuthFormState } from "./auth";

const accountInput = z.object({
  email: z.email(),
  password: z.string().min(12).max(128),
});
function requireSignup() {
  if (!publicSignupEnabled())
    throw new AppError("NOT_ELIGIBLE", "New shop signup is not open yet.");
}
export async function signUpOwner(
  _: AuthFormState | null,
  form: FormData,
): Promise<AuthFormState> {
  const meta = await getRequestMeta();
  try {
    requireSignup();
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
    requireSignup();
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.getUser();
    const u = data.user;
    if (error || !u?.email || !u.email_confirmed_at)
      throw new AppError(
        "FORBIDDEN",
        "Sign in and confirm your email before creating your shop.",
      );
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
