import { HydratedMain } from "@/components/hydrated-main";
import Link from "next/link";
import { publicSignupEnabled } from "@/lib/billing";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/safe-next";
import { getSessionState } from "@/server/auth/session";
import { SignInForms } from "./sign-in-forms";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; reason?: string }>;
}) {
  const sp = await searchParams;
  const state = await getSessionState();
  if (state.kind === "shop") redirect(safeNext(sp.next));
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Sign in</h1>
      {sp.error === "confirmation" && (
        <p className="notice error">
          That confirmation link expired or was already used. Sign in if you
          already confirmed your email, or request a new signup email.
        </p>
      )}
      {sp.error === "recovery" && (
        <p className="notice error">
          That password reset link expired or was already used. Request a new
          one.
        </p>
      )}
      {sp.reason === "removed" && (
        <p className="notice error">Your access to this shop has ended.</p>
      )}
      <SignInForms next={safeNext(sp.next)} />
      {publicSignupEnabled() && (
        <p>
          <Link className="btn secondary" href="/sign-up">
            Create an account
          </Link>
        </p>
      )}
    </HydratedMain>
  );
}
