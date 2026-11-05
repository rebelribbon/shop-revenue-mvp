import Link from "next/link";
import { publicSignupEnabled } from "@/lib/billing";
import { HydratedMain } from "@/components/hydrated-main";
export default function NoAccess() {
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>No shop access</h1>
      <p>
        You’re signed in, but this login isn’t connected to an active shop. If
        you were invited, open the invite link again, or ask the shop owner to
        resend it.
      </p>
      {publicSignupEnabled() && (
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
