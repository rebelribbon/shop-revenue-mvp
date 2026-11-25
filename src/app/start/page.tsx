import Link from "next/link";
import { redirect } from "next/navigation";
import { HydratedMain } from "@/components/hydrated-main";
import { shopSignupEnabledFor } from "@/lib/shop-signup-access";
import { canMakeChanges } from "@/lib/billing";
import { getSessionState } from "@/server/auth/session";
import { sessionNeedsMfa } from "@/server/auth/assurance";
import { readOnboarding } from "@/domain/onboarding";
import { getBusinessProfile } from "@/domain/business-profile";
import { shopBillingAccess } from "@/domain/billing";
import { withTenant } from "@/db/tenant";
import { ShopForm } from "./shop-form";
export default async function StartShop({ searchParams }: PageProps<"/start">) {
  const state = await getSessionState();
  if (state.kind === "anonymous") redirect("/sign-in?next=/start");
  if (await sessionNeedsMfa()) redirect("/verify?next=/start");
  if (
    state.kind === "shop" &&
    (state.session.role !== "owner" || state.session.actor.type !== "user")
  )
    redirect("/app");
  const progress = await readOnboarding(state.identity.authSubject);
  const params = await searchParams;
  const requested = Number(params.step);
  const step =
    Number.isInteger(requested) && requested > 0 && requested <= progress.step
      ? requested
      : progress.step;
  const details =
    state.kind === "shop"
      ? await withTenant(
          state.session.businessId,
          state.session.actor,
          async (tx) => ({
            profile: await getBusinessProfile(tx),
            billing: await shopBillingAccess(tx),
          }),
        )
      : null;
  const eligible =
    state.kind === "shop" || shopSignupEnabledFor(state.identity.email);
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>
        {progress.completed && !params.step
          ? "Your business is ready"
          : "Set up your business"}
      </h1>
      {progress.completed && !params.step ? (
        <section className="card">
          <p>Your business details and preferences are saved.</p>
          <ul>
            <li>Business profile: saved</li>
            <li>Sign-in security: verified</li>
            <li>
              Subscription:{" "}
              {details && canMakeChanges(details.billing)
                ? "active"
                : "start your trial before adding customers"}
            </li>
            <li>Team and customer payments: available in Settings</li>
          </ul>
          <Link
            className="btn primary"
            href={
              details && canMakeChanges(details.billing)
                ? "/app/customers/new"
                : "/app/settings/billing"
            }
          >
            {details && canMakeChanges(details.billing)
              ? "Add your first customer"
              : "Start your free trial"}
          </Link>
          <p>
            <Link href="/app">Open workspace</Link> ·{" "}
            <Link href="/start?step=1">Review business setup</Link>
          </p>
        </section>
      ) : eligible ? (
        <ShopForm
          key={`${step}:${progress.version}`}
          progress={progress}
          step={step}
          profile={details?.profile}
          billingReady={!!details && canMakeChanges(details.billing)}
        />
      ) : (
        <p>New business signup is being configured.</p>
      )}
    </HydratedMain>
  );
}
