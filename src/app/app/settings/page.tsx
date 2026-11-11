import { HydratedMain } from "@/components/hydrated-main";
import Link from "next/link";
import { requireFrontOfficeView } from "@/server/views/shop";

export default async function SettingsPage() {
  const s = await requireFrontOfficeView("/app/settings");
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Settings</h1>
      <Link
        href="/app/settings/business"
        className="btn primary"
        data-page-primary
      >
        Business setup
      </Link>
      <form action="/auth/sign-out" method="post">
        <button className="btn secondary">Sign out</button>
      </form>
      <div className="settings-grid">
        {s.role === "owner" && (
          <Link className="card settings-link" href="/app/settings/booking">
            <strong>Online booking</strong>
            <span className="muted">
              A “Book a visit” link for your website and Google profile
            </span>
          </Link>
        )}
        {s.role === "owner" && (
          <Link className="card settings-link" href="/app/settings/follow-ups">
            <strong>Follow-up rules</strong>
            <span className="muted">
              Who to call and how often: leads, estimates, unpaid invoices, work
              updates and past customers
            </span>
          </Link>
        )}
        {s.role === "owner" && (
          <Link className="card settings-link" href="/app/settings/common-jobs">
            <strong>Common jobs</strong>
            <span className="muted">Saved items, prices and labor</span>
          </Link>
        )}
        <Link className="card settings-link" href="/verify?next=/app/settings">
          <strong>Authenticator security</strong>
          <span className="muted">Set up or verify your authenticator</span>
        </Link>
        {s.role === "owner" && (
          <Link className="card settings-link" href="/app/settings/documents">
            <strong>Documents to sign</strong>
            <span className="muted">
              Agreements, waivers and change orders customers e-sign
            </span>
          </Link>
        )}
        {s.role === "owner" && (
          <Link className="card settings-link" href="/app/settings/invoices">
            <strong>Invoice layout</strong>
            <span className="muted">
              Choose what customers see on every invoice
            </span>
          </Link>
        )}
        {s.role === "owner" && (
          <Link className="card settings-link" href="/app/settings/payments">
            <strong>Online payments</strong>
            <span className="muted">
              Set up Stripe to receive customer invoice payments in your shop’s
              account
            </span>
          </Link>
        )}
        {s.role === "owner" && (
          <Link className="card settings-link" href="/app/settings/billing">
            <strong>Billing</strong>
            <span className="muted">
              Your Shop Revenue subscription, card and receipts
            </span>
          </Link>
        )}
        {s.role === "owner" && (
          <Link className="card settings-link" href="/app/settings/export">
            <strong>Export shop data</strong>
            <span className="muted">
              Download your customer and financial records
            </span>
          </Link>
        )}
        <Link className="card settings-link" href="/app/settings/business">
          <strong>Business profile</strong>
          <span className="muted">
            Business type, name, address and timezone
          </span>
        </Link>
        <Link className="card settings-link" href="/app/settings/team">
          <strong>Team</strong>
          <span className="muted">Owner and staff access</span>
        </Link>
        {s.role !== "staff" && s.role !== "technician" && (
          <Link
            className="card settings-link"
            href="/app/settings/support-access"
          >
            <strong>Support access</strong>
            <span className="muted">Review support access and permissions</span>
          </Link>
        )}
      </div>
    </HydratedMain>
  );
}
