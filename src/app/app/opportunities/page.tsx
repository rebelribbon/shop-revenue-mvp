import { getBusinessProfile } from "@/domain/business-profile";
import Link from "next/link";
import { withTenant } from "@/db/tenant";
import { requireShopSession } from "@/server/views/shop";
import { getMoneyFinder, moneyCategories, type MoneyCategory } from "@/domain/money-finder";
import { listRevenue } from "@/domain/revenue";
import { RevenueSummary } from "@/components/revenue-summary";
import { MoneyFinder } from "@/components/money-finder";

export default async function OpportunitiesPage({searchParams}:{searchParams:Promise<{category?:string;view?:string;q?:string;page?:string}>}) {
  const s=await requireShopSession('/app/opportunities');
  const params=await searchParams;
  const category=moneyCategories.includes(params.category as MoneyCategory)?params.category as MoneyCategory:undefined;
  const view=params.view==='snoozed'||params.view==='dismissed'?params.view:'active';
  const page=Math.max(1,Math.min(Number.parseInt(params.page??'1',10)||1,10000));
  const query=(params.q??'').slice(0,100);
  const [money,revenue,profile]=await withTenant(s.businessId,s.actor,tx=>Promise.all([getMoneyFinder(tx,{category,view,page,query}),listRevenue(tx),getBusinessProfile(tx)]));
  return <main id="main-content" tabIndex={-1}>
    <p><Link href="/app">← Home</Link></p><h1>Money Finder</h1>
    <p className="muted">Choose a recorded opportunity, contact the customer yourself, then track the result.</p>
    <Link className="btn primary" data-page-primary href="#follow-up-list">View follow-up list</Link>
    <MoneyFinder businessType={profile?.businessType} data={money} category={category} view={view} query={query} page={page} readOnly={s.actor.type==='support'}/>
    <RevenueSummary {...revenue}/>
  </main>;
}
