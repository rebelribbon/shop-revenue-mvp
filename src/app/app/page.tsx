import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { business, customer, vehicle } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireShopSession } from "@/server/views/shop";

export default async function MoneyHome({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const s = await requireShopSession("/app");
  const { denied } = await searchParams;
  const setup = await withTenant(s.businessId, s.actor, async (tx) => {
    const [b] = await tx.select().from(business).where(eq(business.id, s.businessId));
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(customer).where(and(eq(customer.businessId, s.businessId), eq(customer.status, "active")));
    const [v] = await tx.select({ n: sql<number>`count(*)::int` }).from(vehicle).where(and(eq(vehicle.businessId, s.businessId), eq(vehicle.status, "active")));
    return {
      profileComplete: Boolean(b?.phoneE164 && b?.addressLine1 && b?.city && b?.region && b?.postalCode),
      customerCount: c.n,
      vehicleCount: v.n,
    };
  });
  const ready = setup.profileComplete && setup.customerCount > 0;
  return (
    <main>
      {denied && <p role="status" className="notice error">Only the owner can open that page.</p>}
      <h1>Money</h1>
      {!ready && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Finish setup</h2>
          <div className="checklist">
            <Link href="/app/settings/business">{setup.profileComplete ? "✓" : "○"} Business profile</Link>
            <Link href="/app/customers#new-customer">{setup.customerCount > 0 ? "✓" : "○"} Add your first customer</Link>
            <Link href="/app/customers">{setup.vehicleCount > 0 ? "✓" : "○"} Add a vehicle</Link>
          </div>
        </div>
      )}
      <div className="card">
        <p>You&rsquo;re signed in as {s.role === "support" ? "support (view-as)" : s.role}.</p>
        <p><strong>{setup.customerCount}</strong> active customers · <strong>{setup.vehicleCount}</strong> active vehicles</p>
        <p className="muted">Money Finder will use your real shop data here in its milestone. No recovered revenue is estimated or invented.</p>
      </div>
    </main>
  );
}
