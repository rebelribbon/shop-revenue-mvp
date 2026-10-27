import Link from "next/link";
import { requireShopSession } from "@/server/views/shop";

export default async function NewPage() {
  await requireShopSession("/app/new");
  return (
    <main>
      <h1>New</h1>
      <div className="new-grid"><Link className="card new-card" href="/app/jobs"><strong>Job sheet</strong><span>Price parts and labor, and track job costs.</span></Link>
        <Link className="card new-card" href="/app/customers#new-customer"><span className="new-icon">＋</span><strong>Customer</strong><span className="muted">Add a customer, then attach their vehicles.</span></Link>
        <Link className="card new-card" href="/app/schedule#new-appointment"><span className="new-icon">▣</span><strong>Appointment</strong><span className="muted">Schedule a customer for today or a future visit.</span></Link>
      </div>
    </main>
  );
}

