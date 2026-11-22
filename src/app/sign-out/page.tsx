import Link from "next/link";
import { HydratedMain } from "@/components/hydrated-main";

export default function SignOutPage() {
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Sign out of Shop Revenue</h1>
      <p>Sign out of this login to return to the sign-in screen.</p>
      <form action="/auth/sign-out" method="post" className="card">
        <button type="submit" className="btn primary">
          Sign out
        </button>
      </form>
      <p>
        <Link href="/app">Keep working</Link>
      </p>
    </HydratedMain>
  );
}
