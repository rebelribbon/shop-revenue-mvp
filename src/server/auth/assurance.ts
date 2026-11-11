import { AppError } from "@/lib/errors";
import { mfaNeeded, mfaRequired } from "@/lib/mfa-policy";
import { supabaseServer } from "./supabase";
export async function sessionNeedsMfa(force = false) {
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
  return mfaNeeded(required, data.currentLevel, data.nextLevel);
}
export async function assertSessionAssurance() {
  if (await sessionNeedsMfa())
    throw new AppError(
      "FORBIDDEN",
      "Verify your authenticator code before continuing.",
    );
}
