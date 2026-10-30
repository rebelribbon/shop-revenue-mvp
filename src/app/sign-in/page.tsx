import { redirect } from "next/navigation";
import { safeNext } from "@/lib/safe-next";
import { getSessionState } from "@/server/auth/session";
import { SignInForms } from "./sign-in-forms";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; reason?: string }> }) {
  const sp = await searchParams;
  const state = await getSessionState();
  if (state.kind === "shop") redirect(safeNext(sp.next));
  return (
    <main id="main-content" tabIndex={-1}>
      <h1>Sign in</h1>
      {sp.error === "recovery" && <p className="notice error">That password reset link expired or was already used. Request a new one.</p>}
      {sp.reason === "removed" && <p className="notice error">Your access to this shop has ended.</p>}
      <SignInForms next={safeNext(sp.next)} />
    </main>
  );
}

