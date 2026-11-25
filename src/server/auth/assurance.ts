import { AppError } from "@/lib/errors";
import { mfaNeeded, mfaRequired } from "@/lib/mfa-policy";
import { supabaseServer } from "./supabase";
import { hasEmailStep, securityContext } from "./email-security";
export async function sessionNeedsMfa(force = false, allowEmail = true) {
  const required = mfaRequired(process.env, force);
  // Not required here (local development or the test-data preview site).
  // Someone who chose to enroll an authenticator is still asked for it below
  // on hosted sites.
  const env = process.env.APP_ENV ?? "local";
  if (["local", "test"].includes(env) && !required) return false;
  const supabase = await supabaseServer();
  const { data, error } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data)
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      "Security verification is unavailable. Sign in again.",
    );
  if (data.currentLevel === "aal2") return false;
  if (allowEmail && !force) {
    try {
      if (await hasEmailStep(await securityContext())) return false;
    } catch {
      // An unavailable or invalid email proof never grants access. The
      // required second step below stays in force.
    }
  }
  return mfaNeeded(required, data.currentLevel, data.nextLevel);
}
export async function assertSessionAssurance(allowEmail = true) {
  if (await sessionNeedsMfa(false, allowEmail))
    throw new AppError(
      "FORBIDDEN",
      "Complete two-step verification before continuing.",
    );
}
