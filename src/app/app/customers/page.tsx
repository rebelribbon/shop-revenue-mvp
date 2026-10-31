import { HydratedMain } from "@/components/hydrated-main";
import { getBusinessProfile } from "@/domain/business-profile";
import { isAutomotive } from "@/lib/business-types";
import { and, eq, inArray } from "drizzle-orm";
import { vehicle } from "@/db/schema";
import Link from "next/link";
import { WorkspaceIcon } from "@/components/workspace-icon";
import { withTenant } from "@/db/tenant";
import { listCustomers } from "@/domain/customers";
import { requireShopSession } from "@/server/views/shop";

export default async function CustomersPage(props: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const searchParams = await props.searchParams;
  const q = searchParams?.q?.trim() ?? "";
  const s = await requireShopSession("/app/customers");
  const profile = await withTenant(s.businessId, s.actor, (tx) =>
    getBusinessProfile(tx),
  );
  const auto = isAutomotive(profile?.businessType ?? "automotive");
  const customers = await withTenant(s.businessId, s.actor, (tx) =>
    listCustomers(tx, q),
  );
  const vehicles = customers.length
    ? await withTenant(s.businessId, s.actor, (tx) =>
        tx
          .select({
            id: vehicle.id,
            customerId: vehicle.customerId,
            year: vehicle.year,
            make: vehicle.make,
            model: vehicle.model,
          })
          .from(vehicle)
          .where(
            and(
              eq(vehicle.businessId, s.businessId),
              eq(vehicle.status, "active"),
              inArray(
                vehicle.customerId,
                customers.map((c) => c.id),
              ),
            ),
          )
          .limit(300),
      )
    : [];
  const byCustomer = new Map<string, typeof vehicles>();
  for (const item of vehicles) {
    const group = byCustomer.get(item.customerId);
    if (group) group.push(item);
    else byCustomer.set(item.customerId, [item]);
  }
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Customers</h1>
      <Link
        id="new-customer"
        href="/app/customers/new"
        className="btn primary"
        data-page-primary
        data-stable-primary
      >
        Add customer
      </Link>
      <p className="muted">
        {auto
          ? "Search by customer name, phone, email, plate, or last 6 of the VIN."
          : "Search customers, service addresses, ZIP codes, equipment and serial numbers."}
      </p>
      <div className="card">
        <form method="get" className="search-form">
          <label htmlFor="q">Search</label>
          <div className="search-controls">
            <input
              id="q"
              name="q"
              defaultValue={q}
              placeholder={
                auto
                  ? "Name, phone, plate, last 6 VIN"
                  : "Name, phone, address, equipment serial"
              }
            />
            <button className="btn secondary" type="submit">
              Search
            </button>
          </div>
          {q && (
            <Link className="btn secondary" href="/app/customers">
              Clear
            </Link>
          )}
        </form>
      </div>
      <section className="customer-index" aria-label="Customer results">
        {customers.map((c) => {
          const linked = byCustomer.get(c.id) ?? [];
          return (
            <article className="customer-row" key={c.id}>
              <div className="customer-core">
                <h2 className="customer-row-title">
                  <Link
                    className="customer-name"
                    href={`/app/customers/${c.id}`}
                  >
                    <strong>{c.displayName}</strong>
                  </Link>
                </h2>
                <div className="customer-contacts">
                  {c.phoneE164 && (
                    <a href={`tel:${c.phoneE164}`}>{c.phoneE164}</a>
                  )}
                  {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                  {!c.phoneE164 && !c.email && (
                    <span className="muted">No contact details yet</span>
                  )}
                </div>
              </div>
              <div className="customer-vehicles">
                {linked.slice(0, 2).map((v) => {
                  const name =
                    [v.year, v.make, v.model].filter(Boolean).join(" ") ||
                    "Vehicle";
                  return (
                    <div className="asset-shortcut" key={v.id}>
                      <Link href={`/app/customers/${c.id}/vehicles/${v.id}`}>
                        {name}
                      </Link>
                      <Link
                        className="btn secondary icon-button"
                        href={`/app/customers/${c.id}/vehicles/${v.id}?view=edit`}
                        aria-label={`Edit vehicle details: ${name}`}
                        title="Edit vehicle details"
                      >
                        <WorkspaceIcon name="edit" />
                      </Link>
                    </div>
                  );
                })}
                {linked.length > 2 && (
                  <Link href={`/app/customers/${c.id}?view=assets`}>
                    More vehicles
                  </Link>
                )}
              </div>
              <Link
                className="btn secondary customer-edit"
                href={`/app/customers/${c.id}?view=details`}
                aria-label={`Edit customer details: ${c.displayName}`}
              >
                <WorkspaceIcon name="edit" />
                Edit
              </Link>
            </article>
          );
        })}
        {!customers.length && (
          <div className="empty-records">
            <h2>{q ? "No matching customers" : "No customers yet"}</h2>
            <p className="muted">
              {q
                ? "Try a name, phone number or a different search term."
                : "Add your first customer to start keeping their work and history together."}
            </p>
          </div>
        )}
      </section>
    </HydratedMain>
  );
}
