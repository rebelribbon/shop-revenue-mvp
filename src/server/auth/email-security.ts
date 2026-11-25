import { cookies } from "next/headers";
import {
  securityPreference,
  SECOND_STEP_SECONDS,
  type SecurityContext,
} from "@/domain/email-security";
import { AppError } from "@/lib/errors";
import { getIdentity, signValue, verifySigned } from "./session";
import { AUTH_COOKIE_OPTIONS, supabaseServer } from "./supabase";

export const PASSWORD_STEP_COOKIE = "sr_password_step";
export const EMAIL_STEP_COOKIE = "sr_email_step";

export async function securityContext(): Promise<SecurityContext> {
  const identity = await getIdentity();
  if (!identity?.email)
    throw new AppError(
      "FORBIDDEN",
      "Sign in with your email and password first.",
    );
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (
    error ||
    claims?.sub !== identity.authSubject ||
    typeof claims.session_id !== "string"
  )
    throw new AppError("FORBIDDEN", "Sign in again to verify your account.");
  return {
    authSubject: identity.authSubject,
    email: identity.email,
    sessionId: claims.session_id,
  };
}

export async function grantPasswordStep() {
  const c = await securityContext();
  (await cookies()).set(
    PASSWORD_STEP_COOKIE,
    signValue(
      JSON.stringify([
        c.authSubject,
        c.sessionId,
        Date.now() + SECOND_STEP_SECONDS * 1000,
      ]),
    ),
    { ...AUTH_COOKIE_OPTIONS, maxAge: SECOND_STEP_SECONDS },
  );
  (await cookies()).delete(EMAIL_STEP_COOKIE);
}

export async function hasPasswordStep(c: SecurityContext) {
  const signed = verifySigned(
    (await cookies()).get(PASSWORD_STEP_COOKIE)?.value,
  );
  if (!signed) return false;
  try {
    const [subject, session, until] = JSON.parse(signed);
    return (
      subject === c.authSubject &&
      session === c.sessionId &&
      typeof until === "number" &&
      until > Date.now()
    );
  } catch {
    return false;
  }
}

export async function grantEmailStep(c: SecurityContext, version: number) {
  (await cookies()).set(
    EMAIL_STEP_COOKIE,
    signValue(
      JSON.stringify([
        c.authSubject,
        c.sessionId,
        version,
        Date.now(),
        Date.now() + SECOND_STEP_SECONDS * 1000,
      ]),
    ),
    { ...AUTH_COOKIE_OPTIONS, maxAge: SECOND_STEP_SECONDS },
  );
}

export async function hasEmailStep(c: SecurityContext, fresh = false) {
  if (!(await hasPasswordStep(c))) return false;
  const signed = verifySigned((await cookies()).get(EMAIL_STEP_COOKIE)?.value);
  if (!signed) return false;
  try {
    const [subject, session, version, at, until] = JSON.parse(signed);
    if (
      subject !== c.authSubject ||
      session !== c.sessionId ||
      typeof until !== "number" ||
      until <= Date.now() ||
      (fresh && (typeof at !== "number" || Date.now() - at > 5 * 60_000))
    )
      return false;
    const preference = await securityPreference(c.authSubject);
    return preference.method === "email" && preference.version === version;
  } catch {
    return false;
  }
}

export async function clearSecondStep() {
  const jar = await cookies();
  jar.delete(PASSWORD_STEP_COOKIE);
  jar.delete(EMAIL_STEP_COOKIE);
}
