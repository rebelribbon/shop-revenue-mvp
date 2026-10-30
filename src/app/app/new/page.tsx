import { withTenant } from "@/db/tenant";
import { getBusinessProfile } from "@/domain/business-profile";
import { isAutomotive } from "@/lib/business-types";
import Link from "next/link";
import { requireShopSession } from "@/server/views/shop";

export default async function NewPage() {
  const s = await requireShopSession("/app/new");
  const profile = await withTenant(s.businessId,s.actor,tx=>getBusinessProfile(tx));
  const auto = isAutomotive(profile?.businessType??"automotive");
  return (
    <main id="main-content" tabIndex={-1}>
      <h1>New</h1><Link className="btn primary" data-page-primary href="/app/jobs">Start a job / estimate</Link>
      <div className="new-grid"><Link className="card new-card" href="/app/invoices"><strong>Invoice</strong><span>Invoice approved work and record payments.</span></Link><Link className="card new-card" href="/app/jobs"><strong>Job / Estimate</strong><span>Price materials and labor, and track job costs.</span></Link>
        <Link className="card new-card" href="/app/customers#new-customer"><span className="new-icon">＋</span><strong>Customer</strong><span className="muted">{auto?"Add a customer, then attach their vehicles.":"Add a customer, then their properties and equipment."}</span></Link>
        <Link className="card new-card" href="/app/schedule#new-appointment"><span className="new-icon">▣</span><strong>Appointment</strong><span className="muted">Schedule a customer for today or a future visit.</span></Link>
      </div>
    </main>
  );
}

