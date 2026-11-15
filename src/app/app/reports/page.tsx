import { HydratedMain } from "@/components/hydrated-main";
import Link from "next/link";
import { formatMoney } from "@/components/estimate-document";
import { withTenant } from "@/db/tenant";
import { getBusinessProfile } from "@/domain/business-profile";
import {
  REPORTS,
  presetRange,
  runReport,
  type ReportKey,
} from "@/domain/reports";
import { localDateKey } from "@/lib/timezone";
import { requireShopSession } from "@/server/views/shop";
import { listSavedReports } from "@/domain/report-builder";

const PRESETS = [
  ["month", "This month"],
  ["last-month", "Last month"],
  ["quarter", "This quarter"],
  ["last-quarter", "Last quarter"],
  ["year", "This year"],
  ["last-year", "Last year"],
] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const nice = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    report?: string;
    range?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const s = await requireShopSession("/app/reports");
  if (s.role === "staff" || s.role === "technician") {
    return (
      <HydratedMain id="main-content" tabIndex={-1}>
        <h1>Reports</h1>
        <section className="card">
          <h2>Owner access required</h2>
          <p>
            Business-wide financial and performance reports are available to
            ¶»§q«^