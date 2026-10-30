import { getBusinessProfile } from "@/domain/business-profile";
import { isAutomotive } from "@/lib/business-types";
import { and, eq, inArray } from "drizzle-orm";
import { vehicle } from "@/db/schema";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { withTenant } from "@/db/tenant";
import { listCustomers } from "@/domain/customers";
import { createCustomerAction } from "@/server/actions/customers";
import { requireShopSession } from "@/server/views/shop";

export default async function CustomersPage(props: { searchParams?: Promise<{ q?: string }> }) {
  const searchParams = await props.searchParams;
  const q = searchParams?.q?.trim() ?? "";
  const s = await requireShopSession("/app/customers");
  const profile = await withTenant(s.businessId,s.actor,tx=>getBusinessProfile(tx));
  const auto = isAutomotive(profile?.businessType??"automotive");
  const customers = await withTenant(s.businessId, s.actor, (tx) => listCustomers(tx, q));
  const vehicles = customers.length ? await withTenant(s.businessId,s.actor,tx=>tx.select({id:vehicle.id,customerId:vehicle.customerId,year:vehicle.year,make:vehicle.make,model:vehicle.model}).from(vehicle).where(and(eq(vehicle.businessId,s.businessId),eq(vehicle.status,"active"),inArray(vehicle.customerId,customers.map(c=>c.id)))).limit(300)) : [];
  return (
    <main id="main-content" tabIndex={-1}>
      <h1>Customers</h1>
      <p className="muted">{auto ? "Search by customer name, phone, email, plate, or last 6 of the VIN." : "Search customers, service addresses, ZIP codes, equipment and serial numbers."}</p>
      <div className="card">
        <form method="get" className="search-form">
          <div ><label htmlFor="q">Search</label><input id="q" name="q" defaultValue={q} placeholder={auto?"Name, phone, plate, last 6 VIN":"Name, phone, address, equipment serial"} /></div>
          <button className="btn secondary" type="submit">Search</button>{q && <Link className="btn secondary" href="/app/customers">Clear</Link>}
        </form>
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Customer</th><th>Phone</th><th>Email</th></tr></thead>
          <tbody>
            {customers.map((c) => <tr key={c.id}><td><Link href={`/app/customers/${c.id}`}><strong>{c.displayName}</strong></Link><div className="record-shortcuts">{vehicles.filter(v=>v.customerId===c.id).slice(0,2).map(v=><Link key={v.id} href={`/app/customers/${c.id}/vehicles/${v.id}`}>{[v.year,v.make,v.model].filter(Boolean).join(" ")||"Open vehicle"}</Link>)}</div></td><td>{c.phoneE164 ?? "—"}</td><td>{c.email ?? "—"}</td></tr>)}
            {!customers.length && <tr><td colSpan={3} className="muted">{q ? "No customers matched that search." : "No customers yet."}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card" id="new-customer">
        <h2 style={{ marginTop: 0 }}>New customer</h2>
        <ActionForm variant="primary" action={createCustomerAction} submitLabel="Add customer">
          <label htmlFor="firstName">First name</label><input id="firstName" name="firstName" maxLength={100} />
          <label htmlFor="lastName">Last name</label><input id="lastName" name="lastName" maxLength={100} />
          <label htmlFor="phone">Mobile number</label><input id="phone" name="phone" type="tel" inputMode="tel" />
          <label htmlFor="email">Email</label><input id="email" name="email" type="email" />
          <label htmlFor="notes">Notes</label><textarea id="notes" name="notes" rows={4} maxLength={5000} />
        </ActionForm>
      </div>
    </main>
  );
}

