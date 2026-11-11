import Link from "next/link";
import { redirect } from "next/navigation";
import { HydratedMain } from "@/components/hydrated-main";
import { publicSignupEnabled, TRIAL_DAYS } from "@/lib/billing";
import { getSessionState } from "@/server/auth/session";
import { SignupForm } from "./signup-form";
export default async function SignupPage() {
  const state = await getSessionState();
  if (state.kind === "shop") redirect("/app/settings/billing");
  if (state.kind === "no_access") redirect("/start");
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Create your Shop Revenue login</h1>
      {publicSignupEnabled() ? (
        <>
          <p>
            Confirm your email, name your shop, then start your {TRIAL_DAYS}-day
            free trial in Stripe. A card is required to start the trial.
          </p>
          <SignupForm />
        </>
      ) : (
        <p>New shop signup is being configured. Please check back soon.</p>
      )}
      <p>
        <Link href="/sign-in?next=/start">Already have a login? Sign in</Link>
      </p>
    </HydratedMain>
  );
}
