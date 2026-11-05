import { withTenant } from "@/db/tenant";
import { getBusinessProfile } from "@/domain/business-profile";
import {
  REPORTS,
  presetRange,
  reportCsv,
  runReport,
  type ReportKey,
} from "@/domain/reports";
import { localDateKey } from "@/lib/timezone";
import { buildReport, readConfig } from "@/domain/report-builder";
import { getSessionState } from "@/server/auth/session";

export const dynamic = "force-dynamic";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const state = await getSessionState();
  // Owner (or support view-as) only: staff and technicians can't export.
  if (
    state.kind !== "shop" ||
    state.session.role === "staff" ||
    state.session.role === "technician"
  )
    return new Response("Not found", { status: 404 });
  const q = new URL(req.url).searchParams;
  if (q.get("custom") === "1") {
    const config = readConfig(Object.fromEntries(q));
    const out = await withTenant(
      state.session.businessId,
      state.session.actor,
      async (tx) => {
        const profile = await getBusinessProfile(tx);
        const today = localDateKey(
          new Date(),
          profile?.timezone || "America/Chicago",
        );
        const range = presetRange(config.range, today);
        return { csv: reportCsv(await buildReport(tx, config, range)), range };
      },
    );
    return new Response("\uFEFF" + out.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="report-${config.source}-by-${config.group}-${out.range.from}-to-${out.range.to}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  const key = REPORTS.find((r) => r.key === q.get("report"))?.key as
    ReportKey | undefined;
  if (!key) return new Response("Not found", { status: 404 });
  const from = q.get("from"),
    to = q.get("to");
  const { csv, range } = await withTenant(
    state.session.businessId,
    state.session.actor,
    async (tx) => {
      const profile = await getBusinessProfile(tx);
      const today = localDateKey(
        new Date(),
        profile?.timezone || "America/Chicago",
      );
      const range =
        from && to && DAY.test(from) && DAY.test(to) && from <= to
          ? { from, to }
          : presetRange(q.get("range") ?? "month", today);
      return { csv: reportCsv(await runReport(tx, key, range)), range };
    },
  );
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${key}-${range.from}-to-${range.to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
