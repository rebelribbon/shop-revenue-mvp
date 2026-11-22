import Link from "next/link";
import { shopSignupEnabledFor } from "@/lib/shop-signup-access";
import { HydratedMain } from "@/components/hydrated-main";
import { getIdentity } from "@/server/auth/session";
export default async function NoAccess() {
  const identity = await getIdentity();
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>No shop access</h1>
      <p>
        You’re signed in, but this login isn’t connected to an active shop. If
        you were invited, open the invite link again, or ask the shop owner to
        resend it.
      </p>
      {shopSignupEnabledFor(identity?.email) && (
        <p>
          <Link href="/start">Create your own shop</Link>
        </p>
      )}
      <form action="/auth/sign-out" method="post">
        <button className="btn secondary">Sign out</button>
      </form>
    </HydratedMain>
  );
}
