import { HydratedMain } from "@/components/hydrated-main";
import Link from "next/link";
export default function AdminHelp() {
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Admin help</h1>
      <p>Use tenant records to review access and help a business owner.</p>
      <Link href="/admin" className="btn primary" data-page-primary>
        Find a business
      </Link>
      <form action="/auth/sign-out" method="post">
        <button className="btn secondary">Sign out</button>
      </form>
      <section className="card">
        <h2>Read-only support</h2>
        <p>
          Open a tenant and enter the owner’s support request before starting
          view-as. The session is visible to the owner and ends after 60
          minutes. Use End view-as to return to admin.
        </p>
      </section>
      <section className="card">
        <h2>Account changes</h2>
        <p>
          Only admins can manage invitations, policies and webhooks. Staff
          access changes require an owner request and are recorded in the audit
          log.
        </p>
      </section>
      <section className="card">
        <h2>Release checks</h2>
        <p>
          Review readiness before a release. Configuration checks do not replace
          real email, payment, recovery and monitoring verification.
        </p>
        <Link href="/admin/release">Open release readiness</Link>
      </section>
    </HydratedMain>
  );
}
