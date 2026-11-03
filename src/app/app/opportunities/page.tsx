import { HydratedMain } from "@/components/hydrated-main";
import { TasksNavigation } from "@/components/tasks-navigation";
import { getBusinessProfile } from "@/domain/business-profile";
import Link from "next/link";
import { withTenant } from "@/db/tenant";
import { requireShopSession } from "@/server/views/shop";
import {
  getMoneyFinder,
  moneyCategories,
  type MoneyCategory,
} from "@/domain/money-finder";
import { listRevenue } from "@/domain/revenue";
import { RevenueSummary } from "@/components/revenue-summary";
import { MoneyFinder } from "@/components/money-finder";

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{
    category?: string;
    view?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const s = await requireShopSession("/app/opportunities");
  const params = await searchParams;
  const category = moneyCategories.includes(params.category as MoneyCategory)
    ? (params.category as MoneyCategory)
    : undefined;
  const view =
    params.view === "snoozed" || params.view === "dismissed"
      ? params.view
      : "active";
  const page = Math.max(
    1,
    Math.min(Number.parseInt(params.page ?? "1", 10) || 1, 10000),
  );
  const query = (params.q ?? "").slice(0, 100);
  const [money, revenue, profile] = await withTenant(
    s.businessId,
    s.actor,
    (tx) =>
      Promise.all([
        getMoneyFinder(tx, { category, view, page, query }),
        listRevenue(tx),
        getBusinessProfile(tx),
      ]),
  );
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Tasks</h1>
      <TasksNavigation current="all" />
      <Link className="btn primary" data-page-primary href="#follow-up-list">
        View follow-up list
      </Link>
      <MoneyFinder
        businessType={profile?.businessType}
        data={money}
        category={category}
        view={view}
        query={query}
        page={page}
        readOnly={s.actor.type === "support"}
      />
      <RevenueSummary {...revenue} />
    </HydratedMain>
  );
}
