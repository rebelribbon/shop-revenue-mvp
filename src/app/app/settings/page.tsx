import Link from "next/link";
import { requireShopSession } from "@/server/views/shop";

export default async function SettingsPage() {
  const s = await requireShopSession("/app/settings");
  return (
    <main>
      <h1>Settings</h1>
      <div className="settings-grid">
        <Link className="card settings-link" href="/app/settings/business"><strong>Business profile</strong><span className="muted">Shop name, phone, address and timezone</span></Link>
        <Link className="card settings-link" href="/app/settings/team"><strong>Team</strong><span className="muted">Owner and staff access</span></Link>
        {s.role !== "staff" && <Link className="card settings-link" href="/app/settings/support-access"><strong>Support access</strong><span className="muted">Review support access and permissions</span></Link>}
      </div>
    </main>
  );
}
