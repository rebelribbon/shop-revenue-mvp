import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { business, customer, vehicle } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireShopSession } from "@/server/views/shop";
import { getMoneyFinder, moneyCategories, type MoneyCategory } from "@/domain/money-finder";
import { MoneyFinder } from "@/components/money-finder";

export default async function MoneyHome({ searchParams }: { searchParams: Promise<{ denied?: string;category?:string;view?:string;q?:string;page?:string }> }) {
  const s = await requireShopSession("/app");
  const { denied,...params } = await searchParams;
  const category=moneyCategories.includes(params.category as MoneyCategory)?params.category as MoneyCategory:undefined;
  const view=params.view==='snoozed'||params.view==='dismissed'?params.view:'active';
  const page=Math.max(1,Math.min(Number.parseInt(params.page??'1',10)||1,10000));
  const query=(params.q??'').slice(0,100);
  const money=await withTenant(s.businessId,s.actor,tx=>getMoneyFinder(tx,{category,view,page,query}));
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
        <p className="muted">Money Finder uses recorded shop history. You contact customers through your own phone or email.</p>
      </div>
      <MoneyFinder data={money} category={category} view={view} query={query} page={page} readOnly={s.actor.type==='support'}/>
    </main>
  );
}

