import Link from "next/link";
import { redirect } from "next/navigation";
import { HydratedMain } from "@/components/hydrated-main";
import { publicSignupEnabled } from "@/lib/billing";
import { getSessionState } from "@/server/auth/session";
import { ShopForm } from "./shop-form";
export default async function StartShop() {
  const state = await getSessionState();
  if (state.kind === "anonymous") redirect("/sign-in?next=/start");
  if (state.kind === "shop") redirect("/app/settings/billing");
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Set up your shop</h1>
      {publicSignupEnabled() ? (
        <ShopForm />
      ) : (
        <p>New shop signup is being configured.</p>
      )}
      <p>
        <Link href="/sign-in">Back to sign in</Link>
      </p>
    </HydratedMain>
  );
}
