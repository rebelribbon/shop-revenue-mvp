export function mfaRequired(
  env: Record<string, string | undefined>,
  force = false,
) {
  let localAuth = !env.NEXT_PUBLIC_SUPABASE_URL;
  if (env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      localAuth = ["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname,
      );
    } catch {
      localAuth = false;
    }
  }
  const local = ["local", "test"].includes(env.APP_ENV ?? "local") && localAuth;
  // The hosted preview site holds test data only, so a test login there is
  // email and password. Vercel sets VERCEL_ENV itself; anything configured as
  // production keeps the requirement even on a preview-type deployment.
  const preview = env.VERCEL_ENV === "preview" && env.APP_ENV !== "production";
  return (
    force ||
    (!local && !preview) ||
    env.REQUIRE_MFA === "true" ||
    env.REQUIRE_OWNER_MFA === "true"
  );
}

export function mfaNeeded(
  required: boolean,
  currentLevel: string | null,
  nextLevel: string | null,
) {
  return currentLevel !== "aal2" && (required || nextLevel === "aal2");
}
