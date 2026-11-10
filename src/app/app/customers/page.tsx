import { formatPhone } from "@/lib/phone-format";
import { HydratedMain } from "@/components/hydrated-main";
import { getBusinessProfile } from "@/domain/business-profile";
import { isAutomotive } from "@/lib/business-types";
import { and, eq, inArray } from "drizzle-orm";
import { vehicle } from "@/db/schema";
import Link from "next/link";
import { withTenant } from "@/db/tenant";
import { listCustomers } from "@/domain/customers";
import { requireFrontOfficeView } from "@/server/views/shop";

export default async function CustomersPage(props: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const searchParams = await props.searchParams;
  const q = searchParams?.q?.trim() ?? "";
  const s = await requireFrontOfficeView("/app/customers");
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
      <form method="get" className="search-form inline-search" role="search">
        <label htmlFor="q">Search customers</label>
        <div className="search-controls">
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder={
              auto
                ? "Name, phone, plate or last 6 of VIN"
                : "Name, phone, address or serial number"
            }
          />
          <button className="btn secondary" type="submit">
            Search
          </button>
          {q && (
            <Link className="btn secondary" href="/app/customers">
              Clear
            </Link>
          )}
        </div>
      </form>
      {customers.length > 0 ? (
        <ul className="row-list card" aria-label="Customer results">
          {customers.map((c) => {
            const linked = byCustomer.get(c.id) ?? [];
            const things = linked
              .slice(0, 2)
              .map(
                (v) =>
                  [v.year, v.make, v.model].filter(Boolean).join(" ") ||
                  "Vehicle",
              );
            if (linked.length > 2) things.push(`+${linked.length - 2} more`);
            return (
              <li key={c.id}>
                <Link
                  href={`/app/customers/${c.id}`}
                  aria-label={c.displayName}
                >
                  <span className="row-main">
                    <strong>{c.displayName}</strong>
                    <span className="muted">
                      {[c.phoneE164 && formatPhone(c.phoneE164), c.email]
                        .filter(Boolean)
                        .join(", ") || "No contact details yet"}
                    </span>
                  </span>
                  {things.length > 0 && (
                    <span className="row-side muted">{things.join(", ")}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty-records">
          <h2>{q ? "No matching customers" : "No customers yet"}</h2>
          <p className="muted">
            {q
              ? "Try a name, phone number or a different search term."
              : "Add your first customer to start keeping their work and history together."}
          </p>
        </div>
      )}
    </HydratedMain>
  );
}
