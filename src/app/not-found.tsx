import { HydratedMain } from "@/components/hydrated-main";
import Link from "next/link";

export default function NotFound() {
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>This link is no longer active</h1>
      <p>
        The estimate, invoice, or booking link you opened has expired, been
        replaced, or is incorrect.
      </p>
      <p>
        Contact the shop for a new link. They can text or email you a fresh one
        in a few seconds.
      </p>
      <p className="muted">
        If you are staff, return to your workspace and open the job or invoice
        to send a new link.
      </p>
      <Link className="btn primary" href="/app">
        Return to workspace
      </Link>
    </HydratedMain>
  );
}
