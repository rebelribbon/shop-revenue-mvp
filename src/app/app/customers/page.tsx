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
  const customers = await withTenant(s.businessId, s.actor, (tx) => listCustomers(tx, q));

  return (
    <main>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <h1>Customers</h1>
          <p className="muted">Search by customer name, phone, email, plate, or last 6 of the VIN.</p>
        </div>
      </div>

      <div className="card">
        <form method="get" style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px" }}>
            <label htmlFor="q">Search</label>
            <input id="q" name="q" defaultValue={q} placeholder="Name, phone, plate, last 6 VIN" />
          </div>
          <button className="btn secondary" type="submit">Search</button>
          {q && <Link className="btn secondary" href="/app/customers">Clear</Link>}
        </form>
      </div>

      <div className="card table-wrap">
        <table>
          <thead><tr><th>Customer</th><th>Phone</th><th>Email</th></tr></thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td><Link href={`/app/customers/${c.id}`}><strong>{c.displayName}</strong></Link></td>
                <td>{c.phoneE164 ?? "—"}</td>
                <td>{c.email ?? "—"}</td>
              </tr>
            ))}
            {!customers.length && (
              <tr><td colSpan={3} className="muted">{q ? "No customers matched that search." : "No customers yet."}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>New customer</h2>
        <ActionForm action={createCustomerAction} submitLabel="Add customer" successText="Customer added.">
          <label htmlFor="firstName">First name</label>
          <input id="firstName" name="firstName" maxLength={100} />
          <label htmlFor="lastName">Last name</label>
          <input id="lastName" name="lastName" maxLength={100} />
          <label htmlFor="phone">Mobile number</label>
          <input id="phone" name="phone" type="tel" inputMode="tel" />
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" />
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" rows={4} maxLength={5000} />
        </ActionForm>
      </div>
    </main>
  );
}
