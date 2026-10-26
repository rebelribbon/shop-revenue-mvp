import Link from "next/link";
import { eq } from "drizzle-orm";
import { business } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireShopSession } from "@/server/views/shop";

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const s = await requireShopSession("/app");
  const [b] = await withTenant(s.businessId, s.actor, (tx) =>
    tx.select({ legalName: business.legalName, dba: business.dba }).from(business).where(eq(business.id, s.businessId)),
  );
  return (
    <>
      {s.supportSession && (
        <div className="banner" role="alert">
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
        <nav className="desktop-nav" aria-label="Main">
          <Link href="/app">Money</Link>
          <Link href="/app/customers">Customers</Link>
          <Link href="/app/schedule">Schedule</Link>
          <Link href="/app/settings">Settings</Link>
          {!s.supportSession && (
            <form action="/auth/sign-out" method="post" style={{ display: "inline" }}>
              <button className="btn secondary compact-btn">Sign out</button>
            </form>
          )}
        </nav>
      </header>
      {children}
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <Link href="/app"><span aria-hidden>◉</span><small>Money</small></Link>
        <Link href="/app/customers"><span aria-hidden>◎</span><small>Customers</small></Link>
        <Link className="mobile-new" href="/app/new"><span aria-hidden>＋</span><small>New</small></Link>
        <Link href="/app/schedule"><span aria-hidden>▣</span><small>Schedule</small></Link>
        <Link href="/app/settings"><span aria-hidden>☰</span><small>Settings</small></Link>
      </nav>
    </>
  );
}
