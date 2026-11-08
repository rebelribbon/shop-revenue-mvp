import { HydratedMain } from "@/components/hydrated-main";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/safe-next";
import { getIdentity, hasPasswordResetGrant } from "@/server/auth/session";
import { supabaseServer } from "@/server/auth/supabase";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const identity = await getIdentity();
  if (!(await hasPasswordResetGrant(identity)))
    redirect("/sign-in?error=recovery");

  // Password-recovery links create an AAL1 session. Supabase requires AAL2
  // to change credentials when the user has an enrolled MFA factor.
  const supabase = await supabaseServer();
  const { data: assurance, error } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !assurance)
    return (
      <HydratedMain id="main-content" tabIndex={-1}>
        <h1>Security verification unavailable</h1>
        <p>Request a new password reset email and try again.</p>
      </HydratedMain>
    );

  const sp = await searchParams;
  if (assurance.nextLevel === "aal2" && assurance.currentLevel !== "aal2") {
    const target = sp.next
      ? `/reset-password?next=${encodeURIComponent(safeNext(sp.next))}`
      : "/reset-password";
    redirect(`/verify?next=${encodeURIComponent(target)}`);
  }

  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Choose a new password</h1>
      <p className="muted">Use at least 8 characters.</p>
      <ResetPasswordForm next={safeNext(sp.next)} />
    </HydratedMain>
  );
}
