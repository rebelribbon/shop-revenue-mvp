import Link from "next/link";
import { requireShopSession } from "@/server/views/shop";

export default async function SettingsPage() {
  const s = await requireShopSession("/app/settings");
  return (
    <main id="main-content" tabIndex={-1}>
      <h1>Settings</h1><Link href="/app/settings/business" className="btn primary" data-page-primary>Business setup</Link>
      <form action="/auth/sign-out" method="post"><button className="btn secondary">Sign out</button></form>
      <div className="settings-grid">
        <Link className="card settings-link" href="/verify?next=/app/settings"><strong>Authenticator security</strong><span className="muted">Set up or verify your authenticator</span></Link>
        {s.role === "owner" && <Link className="card settings-link" href="/app/settings/export"><strong>Export shop data</strong><span className="muted">Download your customer and financial records</span></Link>}
        <Link className="card settings-link" href="/app/settings/business"><strong>Business profile</strong><span className="muted">Business type, name, address and timezone</span></Link>
        <Link className="card settings-link" href="/app/settings/team"><strong>Team</strong><span className="muted">Owner and staff access</span></Link>
        {s.role !== "staff" && <Link className="card settings-link" href="/app/settings/support-access"><strong>Support access</strong><span className="muted">Review support access and permissions</span></Link>}
      </div>
    </main>
  );
}

