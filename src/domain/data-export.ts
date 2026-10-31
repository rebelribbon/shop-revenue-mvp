import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import {
  activity,
  appointment,
  asset,
  assetReading,
  customer,
  estimateAuthorization,
  estimateRecommendationLine,
  estimateVersion,
  invoice,
  invoicePayment,
  note,
  recommendation,
  recoveryItem,
  revenueAttribution,
  revenueAttributionEvent,
  vehicle,
} from "@/db/schema";
import { withTenant, type Actor, type TenantTx } from "@/db/tenant";
import { assertOwner } from "./membership";
import { audit, type RequestMeta } from "./records";
export const exportDatasets = [
  "customers",
  "assets",
  "vehicles",
  "appointments",
  "mileage",
  "notes",
  "history",
  "estimates",
  "authorizations",
  "invoices",
  "payments",
  "recommendations",
  "recovery",
  "revenue",
  "revenue-history",
  "estimate-lines",
] as const;
export type ExportDataset = (typeof exportDatasets)[number];
const tables = {
  customers: customer,
  assets: asset,
  vehicles: vehicle,
  appointments: appointment,
  mileage: assetReading,
  notes: note,
  history: activity,
  estimates: estimateVersion,
  authorizations: estimateAuthorization,
  invoices: invoice,
  payments: invoicePayment,
  recommendations: recommendation,
  recovery: recoveryItem,
  revenue: revenueAttribution,
  "revenue-history": revenueAttributionEvent,
  "estimate-lines": estimateRecommendationLine,
};
const forbidden = new Set([
  "tokenHash",
  "inviteTokenHash",
  "inviteToken",
  "accessToken",
  "refreshToken",
  "secretKey",
  "password",
  "authProviderId",
  "authSubject",
]);
export function exportRecord(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(exportRecord);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !forbidden.has(k))
        .map(([k, v]) => [k, exportRecord(v)]),
    );
  return value;
}
export async function authorizeExport(
  tx: TenantTx,
  meta: RequestMeta,
  dataset: ExportDataset,
) {
  await assertOwner(tx);
  await audit(tx, meta, {
    action: "data.export_requested",
    targetType: "export",
    targetId: null,
    after: { dataset },
  });
}
export async function exportPage(
  tx: TenantTx,
  dataset: ExportDataset,
  cutoff: Date,
  after?: string,
) {
  await assertOwner(tx);
  const table = tables[dataset];
  const rows = await tx
    .select()
    .from(table)
    .where(
      and(
        eq(table.businessId, tx.businessId),
        lte(table.createdAt, cutoff),
        after ? gt(table.id, after) : undefined,
      ),
    )
    .orderBy(asc(table.id))
    .limit(500);
  return rows.map((r) => ({ id: r.id, data: exportRecord(r) }));
}
export function exportStream(
  businessId: string,
  actor: Actor,
  dataset: ExportDataset,
  cutoff = new Date(),
) {
  const encoder = new TextEncoder();
  let cursor: string | undefined,
    buffer: Uint8Array[] = [
      encoder.encode(
        JSON.stringify({
          format: "shop-revenue-ndjson-v1",
          dataset,
          exportedAt: cutoff.toISOString(),
          note: "Owner data export; not a restorable backup. Records can change while this file is produced.",
        }) + "\n",
      ),
    ],
    finished = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (buffer.length) {
          controller.enqueue(buffer.shift()!);
          return;
        }
        if (finished) {
          controller.close();
          return;
        }
        const page = await withTenant(businessId, actor, (tx) =>
          exportPage(tx, dataset, cutoff, cursor),
        );
        if (!page.length) {
          finished = true;
          controller.close();
          return;
        }
        cursor = page[page.length - 1].id;
        buffer = page.map((r) => encoder.encode(JSON.stringify(r.data) + "\n"));
        controller.enqueue(buffer.shift()!);
        if (page.length < 500) finished = true;
      } catch {
        controller.error(new Error("Export interrupted. Retry the download."));
      }
    },
    cancel() {
      finished = true;
      buffer = [];
    },
  });
}
export async function exportCounts(tx: TenantTx) {
  await assertOwner(tx);
  const out: Record<string, number> = {};
  for (const [key, table] of Object.entries(tables)) {
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .where(eq(table.businessId, tx.businessId));
    out[key] = r.n;
  }
  return out;
}
