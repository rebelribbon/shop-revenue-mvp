import { redirect } from "next/navigation";
import { getIdentity } from "@/server/auth/session";
import { supabaseServer } from "@/server/auth/supabase";
import { safeNext } from "@/lib/safe-next";
import { Authenticator } from "@/components/authenticator";
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const identity = await getIdentity();
  if (!identity) redirect("/sign-in");
  const params = await searchParams,
    next = safeNext(typeof params.next === "string" ? params.next : "/app");
  const supabase = await supabaseServer(),
    [{ data: factors, error }, { data: assurance }] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
  if (error)
    return (
      <main id="main-content" tabIndex={-1}>
        <h1>Security verification is unavailable</h1>
        <p>Try signing in again.</p>
      </main>
    );
  return (
    <main id="main-content" tabIndex={-1}>
      <Authenticator
        factors={factors.totp.map((f) => ({
          id: f.id,
          name: f.friendly_name ?? "Authenticator",
        }))}
        next={next === "/verify" ? "/app" : next}
        verified={assurance?.currentLevel === "aal2"}
      />
    </main>
  );
}
