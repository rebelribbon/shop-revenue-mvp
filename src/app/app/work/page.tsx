import Link from "next/link";
import { requireShopSession } from "@/server/views/shop";
export default async function WorkPage() {
  await requireShopSession("/app/work");
  return <main id="main-content" tabIndex={-1}><h1>Work</h1><p>Manage jobs, customer approvals, invoices and recovered revenue.</p>
    <Link href="/app/new" className="btn primary" data-page-primary>New work</Link>
    <div className="settings-grid">
      <Link className="card settings-link" href="/app/jobs"><strong>Jobs &amp; costing</strong><span>Price materials and labor. Compare estimated and actual costs.</span></Link>
      <Link className="card settings-link" href="/app/estimates"><strong>Estimates</strong><span>Review versions, approvals and customer authorization.</span></Link>
      <Link className="card settings-link" href="/app/invoices"><strong>Invoices</strong><span>Issue invoices, record payments and review balances.</span></Link>
      <Link className="card settings-link" href="/app/revenue"><strong>Recovered revenue</strong><span>Review direct and influenced revenue separately.</span></Link>
    </div>
  </main>;
}
