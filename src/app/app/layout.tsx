import { businessTypeLabel, isAutomotive } from "@/lib/business-types";
import { QuickFind } from "@/components/quick-find";
import { WorkspaceIcon } from "@/components/workspace-icon";
import { WorkspaceNavigation } from "@/components/workspace-navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { business } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireShopSession } from "@/server/views/shop";

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const s = await requireShopSession("/app");
  const [b] = await withTenant(s.businessId, s.actor, (tx) =>
    tx.select({ legalName: business.legalName, dba: business.dba, businessType: business.businessType, businessTypeSelected: business.businessTypeSelected }).from(business).where(eq(business.id, s.businessId)),
  );
  return (
    <>
      {s.supportSession && (
        <div className="banner" data-support-view role="alert">
          <span>
            Viewing <strong>{s.supportSession.businessName}</strong> as support (read-only) until{" "}
            {s.supportSession.expiresAt.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })} CT.
          </span>
          <form action="/admin/view-as/end" method="post">
            <input type="hidden" name="sessionId" value={s.supportSession.id} />
            <button className="btn secondary">End view-as</button>
          </form>
        </div>
      )}
      <div className="workspace-shell">
        <aside className="workspace-sidebar"><div className="workspace-brand"><p>Shop Revenue</p><strong>{b?.dba || b?.legalName}</strong><p className="muted workspace-industry">{businessTypeLabel(b?.businessType)}</p></div><WorkspaceNavigation/></aside>
        <header className="workspace-header">
          <strong className="workspace-mobile-brand">{b?.dba || b?.legalName}</strong>
          <QuickFind automotive={isAutomotive(b?.businessType??'automotive')}/>
          <Link className="btn secondary icon-button workspace-mobile-settings" href="/app/settings" aria-label="Settings" title="Settings"><WorkspaceIcon name="settings"/></Link>
        </header>
        <div className="workspace-body">
          {!b?.businessTypeSelected && s.role === "owner" && <div className="notice setup-notice"><Link href="/app/settings/business">Choose your line of business to personalize your workspace →</Link></div>}
          {children}
        </div>
        <WorkspaceNavigation mobile/>
      </div>
    </>
  );
}

