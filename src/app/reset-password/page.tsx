import { HydratedMain } from "@/components/hydrated-main";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/safe-next";
import { getIdentity, hasPasswordResetGrant } from "@/server/auth/session";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const identity = await getIdentity();
  if (!(await hasPasswordResetGrant(identity)))
    redirect("/sign-in?error=recovery");
  const sp = await searchParams;
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Choose a new password</h1>
      <p className="muted">Use at least 8 characters.</p>
      <ResetPasswordForm next={safeNext(sp.next)} />
    </HydratedMain>
  );
}
