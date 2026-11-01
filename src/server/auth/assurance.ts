import { AppError } from "@/lib/errors";
import { mfaNeeded } from "@/lib/mfa-policy";
import { supabaseServer } from "./supabase";
export async function sessionNeedsMfa(
  role: "owner" | "staff" | "support" | "admin",
  force = false,
) {
  const env = process.env.APP_ENV ?? "local";
  if (
    ["local", "test"].includes(env) &&
    !force &&
    process.env.REQUIRE_OWNER_MFA !== "true"
  )
    return false;
  const supabase = await supabaseServer();
  const { data, error } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data)
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      "Security verification is unavailable. Sign in again.",
    );
  const required =
    force ||
    (role === "owner" &&
      (env === "production" || process.env.REQUIRE_OWNER_MFA === "true")) ||
    (["admin", "support"].includes(role) && env === "production");
  return mfaNeeded(required, data.currentLevel, data.nextLevel);
}
export async function assertSessionAssurance(
  role: "owner" | "staff" | "support" | "admin",
) {
  if (await sessionNeedsMfa(role))
    throw new AppError(
      "FORBIDDEN",
      "Verify your authenticator code before continuing.",
    );
}
