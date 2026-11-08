import { isAutomotive } from "@/lib/business-types";
import { QuickFind } from "@/components/quick-find";
import { WorkspaceIcon } from "@/components/workspace-icon";
import { WorkspaceNavigation } from "@/components/workspace-navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { business } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireShopSession } from "@/server/views/shop";
import { shopBillingAccess } from "@/domain/billing";
import { daysUntil } from "@/lib/billing";
import { listTasks } from "@/domain/tasks";

export default async function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const s = await requireShopSession("/app");
  const { b, billing, now, tasksDue } = await withTenant(
    s.businessId,
    s.actor,
    async (tx) => {
      const now = new Date();
      const [b] = await tx
        .select({
          legalName: business.legalName,
          dba: business.dba,
          businessType: business.businessType,
        })
        .from(business)
        .where(eq(business.id, s.businessId));
      return {
        b,
        billing: await shopBillingAccess(tx, now),
        now,
        tasksDue: (await listTasks(tx, now)).due.length,
      };
    },
  );
  const owner = s.role === "owner";
  const billingLink = (text: string) =>
    owner ? <Link href="/app/settings/billing">{text} →</Link> : null;
  return (
    <>
      {s.supportSession && (
        <div className="banner" data-support-view role="alert">
          <span>
            Viewing <strong>{s.supportSession.businessName}</strong> as support
            (read-only) until{" "}
            {s.supportSession.expiresAt.toLocaleTimeString("en-US", {
              timeZone: "America/Chicago",
              hour: "numeric",
              minute: "2-digit",
            })}{" "}
            CT.
          </span>
          <form action="/admin/view-as/end" method="post">
            <input type="hidden" name="sessionId" value={s.supportSession.id} />
            <button className="btn secondary">End view-as</button>
          </form>
        </div>
      )}
      <div className="workspace-shell">
        <aside className="workspace-sidebar">
          <Link href="/app" className="workspace-brand">
            <span className="workspace-brand-mark" aria-hidden="true">
              {(b?.dba || b?.legalName || "S").trim().charAt(0).toUpperCase()}
            </span>
            {b?.dba || b?.legalName}
          </Link>
          <WorkspaceNavigation
            canSeeMoney={s.role === "owner"}
          automotive={isAutomotive(b?.businessType ?? "automotive")}
            automotive={isAutomotive(b?.businessType ?? "automotive")}
            counts={{ "/app/tasks": tasksDue }}
          />
        </aside>
        <header className="workspace-header">
          <Link
            href="/app"
            aria-label="Go home"
            className="workspace-mobile-brand"
          >
            {b?.dba || b?.legalName}
          </Link>
          <QuickFind
            automotive={isAutomotive(b?.businessType ?? "automotive")}
          />
          <Link className="btn new-button" href="/app/create" aria-label="New">
            <span aria-hidden="true">+</span>
            <span className="new-label" aria-hidden="true">
              New
            </span>
          </Link>
          <Link
            className="btn secondary icon-button"
            href="/app/settings"
            aria-label="Settings"
            title="Settings"
          >
            <WorkspaceIcon name="settings" />
          </Link>
        </header>
        <div className="workspace-body">
          {billing.kind === "unavailable" && (
            <p className="notice error">
              Subscription billing needs attention.{" "}
              {billingLink("Contact the owner to restore billing")}
            </p>
          )}
          {billing.kind === "setup" && (
            <div className="notice setup-notice" data-billing="setup">
              {owner
                ? billingLink("Start your 14-day free trial to make changes")
                : "Ask the shop owner to start the Shop Revenue subscription so you can make changes."}
            </div>
          )}
          {billing.kind === "grace" && (
            <div
              className="notice setup-notice"
              role="alert"
              data-billing="grace"
            >
              The last Shop Revenue payment didn’t go through.{" "}
              {owner
                ? billingLink(
                    `Update the card within ${daysUntil(billing.lockAt, now)} days`,
                  )
                : "Let the shop owner know."}
            </div>
          )}
          {billing.kind === "locked" && (
            <div className="banner" role="alert" data-billing="locked">
              <span>
                Read-only: the Shop Revenue subscription is{" "}
                {billing.reason === "payment_failed" ? "unpaid" : "inactive"}.
                You can view and export records but can’t make changes.{" "}
                {owner ? "" : "Ask the shop owner to update billing."}
              </span>
              {billingLink("Fix billing")}
            </div>
          )}
          {billing.kind === "full" &&
            billing.trialEndsAt &&
            !billing.cancelAt &&
            owner &&
            daysUntil(billing.trialEndsAt, now) <= 3 && (
              <div className="notice setup-notice" data-billing="trial">
                Your free trial ends in {daysUntil(billing.trialEndsAt, now)}{" "}
                days. Your card on file will be charged then.{" "}
                {billingLink("Review billing")}
              </div>
            )}
          {children}
        </div>
        <WorkspaceNavigation
          mobile
          canSeeMoney={s.role === "owner"}
          counts={{ "/app/tasks": tasksDue }}
        />
      </div>
    </>
  );
}
