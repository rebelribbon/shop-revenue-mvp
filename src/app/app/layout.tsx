import { WorkspaceNavigation } from "@/components/workspace-navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { business } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireShopSession } from "@/server/views/shop";

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const s = await requireShopSession("/app");
  const [b] = await withTenant(s.businessId, s.actor, (tx) =>
    tx.select({ legalName: business.legalName, dba: business.dba, businessTypeSelected: business.businessTypeSelected }).from(business).where(eq(business.id, s.businessId)),
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
      <header className="topbar">
        <strong>{b?.dba || b?.legalName}</strong>
        <WorkspaceNavigation/>

      </header>
      {!b?.businessTypeSelected && s.role === "owner" && <div className="notice setup-notice"><Link href="/app/settings/business">Choose your line of business to personalize your workspace →</Link></div>}
      {children}
      <WorkspaceNavigation mobile/>
    </>
  );
}

