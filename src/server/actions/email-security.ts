"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkAuthThrottle } from "@/domain/auth-throttle";
import {
  cancelEmailCode,
  consumeEmailCode,
  issueEmailCode,
  securityPreference,
  selectAuthenticator,
} from "@/domain/email-security";
import { AppError } from "@/lib/errors";
import { maskEmail } from "@/lib/normalize";
import { safeNext } from "@/lib/safe-next";
import { emailProvider } from "@/providers/email";
import {
  grantEmailStep,
  hasEmailStep,
  hasPasswordStep,
  securityContext,
} from "@/server/auth/email-security";
import { supabaseServer } from "@/server/auth/supabase";
import { getRequestMeta } from "@/server/request";
import type { AuthFormState } from "./auth";

export async function sendSecondStepCode(
  changeMethod = false,
): Promise<AuthFormState> {
  try {
    const context = await securityContext();
    if (!(await hasPasswordStep(context)))
      throw new AppError(
        "FORBIDDEN",
        "Sign in with your password before requesting a verification code.",
      );
    const supabase = await supabaseServer();
    const [{ data: factors, error }, preference] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      securityPreference(context.authSubject),
    ]);
    if (error)
      throw new AppError(
        "PROVIDER_UNAVAILABLE",
        "Security verification is unavailable.",
      );
    if (
      preference.method === "authenticator" ||
      (preference.method === null && factors.totp.length)
    ) {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const fresh = data?.currentAuthenticationMethods.some(
        (m) =>
          typeof m === "object" &&
          m.method === "totp" &&
          Date.now() / 1000 - m.timestamp < 300,
      );
      if (!changeMethod || data?.currentLevel !== "aal2" || !fresh)
        throw new AppError(
          "FORBIDDEN",
          "Verify your current authenticator code before changing your sign-in method.",
        );
    } else if (
      changeMethod &&
      preference.method === "email" &&
      !(await hasEmailStep(context, true))
    ) {
      throw new AppError(
        "FORBIDDEN",
        "Verify a fresh email code before changing your sign-in method.",
      );
    }
    const meta = await getRequestMeta();
    await checkAuthThrottle(
      "sign_in",
      `email-mfa-send:${context.authSubject}`,
      meta.ip,
    );
    const code = await issueEmailCode(context, changeMethod);
    try {
      await emailProvider().send({
        to: context.email,
        subject: "Your Shop Revenue verification code",
        text: `Your Shop Revenue verification code is ${code}.\n\nIt expires in 10 minutes and works only with the sign-in that requested it. Never share this code. If you did not request it, change your password.`,
      });
    } catch {
      await cancelEmailCode(context);
      throw new AppError(
        "PROVIDER_UNAVAILABLE",
        "We could not send your code. Please try again in a minute.",
      );
    }
    return {
      ok: true,
      message: `A verification code was sent to ${maskEmail(context.email)}.`,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof AppError
          ? error.message
          : "Security verification is unavailable. Please try again.",
    };
  }
}

export async function verifySecondStepCode(
  _: AuthFormState | null,
  form: FormData,
): Promise<AuthFormState> {
  const code = z
    .string()
    .regex(/^\d{6}$/)
    .safeParse(form.get("code"));
  if (!code.success)
    return { ok: false, message: "Enter the six-digit code from your email." };
  try {
    const context = await securityContext();
    if (!(await hasPasswordStep(context)))
      throw new AppError("FORBIDDEN", "Sign in with your password first.");
    const meta = await getRequestMeta();
    await checkAuthThrottle(
      "sign_in",
      `email-mfa-verify:${context.authSubject}`,
      meta.ip,
    );
    const supabase = await supabaseServer();
    const currentFactors = await supabase.auth.mfa.listFactors();
    if (currentFactors.error)
      throw new AppError(
        "PROVIDER_UNAVAILABLE",
        "Security verification is unavailable.",
      );
    const version = await consumeEmailCode(context, code.data);
    if (version === null)
      return {
        ok: false,
        message:
          "That code expired or did not match. Use the newest code or request a new one.",
      };
    if (currentFactors.data.totp.length) {
      // A switch requires a fresh authenticator verification before the email
      // challenge can be issued. Finish replacing the old factor here so the
      // provider's recovery flow follows the selected method too.
      const supabase = await supabaseServer();
      const factors = await supabase.auth.mfa.listFactors();
      if (factors.error) {
        await selectAuthenticator(context.authSubject);
        throw new AppError(
          "PROVIDER_UNAVAILABLE",
          "Could not change your sign-in method. Your authenticator is still required.",
        );
      }
      for (const factor of factors.data.totp) {
        const result = await supabase.auth.mfa.unenroll({
          factorId: factor.id,
        });
        if (result.error) {
          await selectAuthenticator(context.authSubject);
          throw new AppError(
            "PROVIDER_UNAVAILABLE",
            "Could not change your sign-in method. Verify your authenticator and try again.",
          );
        }
      }
    }
    await grantEmailStep(context, version);
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof AppError
          ? error.message
          : "Verification is unavailable. Please try again.",
    };
  }
  redirect(safeNext(String(form.get("next") ?? "/app")));
}
