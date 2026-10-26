import { redirect } from "next/navigation";
import { getInternalUser } from "@/server/auth/session";
import { signInWithGoogle } from "@/server/actions/admin";
import { SignInForms } from "@/app/sign-in/sign-in-forms";

export default async function AdminSignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getInternalUser()) redirect("/admin");
  const { error } = await searchParams;
  const local = ["local", "test"].includes(process.env.APP_ENV ?? "local");
  return (
    <main>
      <h1>Admin sign-in</h1>
      {error && <p className="notice error">Sign-in failed. Only allowlisted team accounts can use the admin console.</p>}
      <form action={signInWithGoogle} className="card">
        <p>Sign in with your company Google Workspace account (MFA enforced by Google).</p>
        <button className="btn primary">Continue with Google</button>
      </form>
      {local && (
        <>
          <p className="muted">Local development only: allowlisted internal users may sign in with their test email and password.</p>
          <SignInForms next="/admin" />
        </>
      )}
    </main>
  );
}
