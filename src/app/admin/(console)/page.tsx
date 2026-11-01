import { HydratedMain } from "@/components/hydrated-main";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { ActionForm } from "@/components/action-form";
import { withAdmin, withAdminTenant } from "@/db/admin";
import { business, membership } from "@/db/schema";
import { createBusinessAction } from "@/server/actions/admin";
import { requireInternal } from "@/server/views/admin";

// I1 Tenants: find a shop, see setup state.
export default async function Tenants({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const me = await requireInternal();
  const { denied } = await searchParams;
  const shops = await withAdmin({ internalUserId: me.id }, (tx) =>
    tx.select().from(business).orderBy(desc(business.createdAt)).limit(200),
  );
  const setup = await Promise.all(
    shops.map((b) =>
      withAdminTenant(b.id, { internalUserId: me.id }, (tx) =>
        tx
          .select({ role: membership.role, status: membership.status })
          .from(membership),
      ),
    ),
  );
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      {denied && <p className="notice error">That page is for admins only.</p>}
      <h1>Tenants</h1>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Shop</th>
              <th>Status</th>
              <th>Owner</th>
              <th>Staff</th>
            </tr>
          </thead>
          <tbody>
            {shops.map((b, i) => {
              const m = setup[i];
              const owner =
                m.find((x) => x.role === "owner" && x.status !== "removed")
                  ?.status ?? "none";
              const staff =
                m.find((x) => x.role === "staff" && x.status !== "removed")
                  ?.status ?? "none";
              return (
                <tr key={b.id}>
                  <td>
                    <Link href={`/admin/tenants/${b.id}`}>
                      {b.dba || b.legalName}
                    </Link>
                  </td>
                  <td>
                    <span className="pill">{b.status}</span>
                  </td>
                  <td>{owner}</td>
                  <td>{staff}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {me.role === "admin" && (
        <div className="card">
          <h2>Create business (F1)</h2>
          <ActionForm
            variant="primary"
            action={createBusinessAction}
            submitLabel="Create and invite owner"
          >
            <label htmlFor="legalName">Legal name</label>
            <input id="legalName" name="legalName" required />
            <label htmlFor="dba">DBA</label>
            <input id="dba" name="dba" />
            <label htmlFor="ownerName">Owner name</label>
            <input id="ownerName" name="ownerName" required />
            <label htmlFor="ownerEmail">Owner email</label>
            <input id="ownerEmail" name="ownerEmail" type="email" />
            <label htmlFor="ownerPhone">or owner mobile</label>
            <input id="ownerPhone" name="ownerPhone" type="tel" />
          </ActionForm>
        </div>
      )}
    </HydratedMain>
  );
}
