import { HydratedMain } from "@/components/hydrated-main";
import { redirect } from "next/navigation";
import { getIdentity } from "@/server/auth/session";
import { supabaseServer } from "@/server/auth/supabase";
import { safeNext } from "@/lib/safe-next";
import { SecurityChoice } from "@/components/security-choice";
import { securityPreference } from "@/domain/email-security";
import { hasPasswordStep, securityContext } from "@/server/auth/email-security";
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const identity = await getIdentity();
  if (!identity) redirect("/sign-in");
  const params = await searchParams,
    next = safeNext(typeof params.next === "string" ? params.next : "/app");
  const settings = params.settings === "1";
  const internal = next.startsWith("/admin") || !!params.internal;
  const context = await securityContext();
  const preference = await securityPreference(identity.authSubject);
  const supabase = await supabaseServer(),
    [{ data: factors, error }, { data: assurance }] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
  if (error)
    return (
      <HydratedMain id="main-content" tabIndex={-1}>
        <h1>Security verification is unavailable</h1>
        <p>Try signing in again.</p>
      </HydratedMain>
    );
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <SecurityChoice
        factors={factors.totp.map((f) => ({
          id: f.id,
          name: f.friendly_name ?? "Authenticator",
        }))}
        next={next === "/verify" ? "/app" : next}
        verified={assurance?.currentLevel === "aal2"}
        method={
          preference.method ?? (factors.totp.length ? "authenticator" : null)
        }
        canEmail={
          !internal &&
          (preference.method === "email" ||
            !factors.totp.length ||
            (settings && assurance?.currentLevel === "aal2"))
        }
        passwordVerified={await hasPasswordStep(context)}
        settings={settings}
        internal={internal}
      />
    </HydratedMain>
  );
}
