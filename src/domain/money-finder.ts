import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  activity,
  customer,
  recommendation,
  recoveryItem,
  vehicle,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError, notFound } from "@/lib/errors";
import { addLocalDays, localDateKey, localMidnightToUtc } from "@/lib/timezone";
import { audit, recordActivity, type RequestMeta } from "./records";
import { getVehicle } from "./customers";

import { currentMemberRole } from "./membership";
import { lockRevenue, reconcileRevenue } from "./revenue";

export const moneyCategories = [
  "declined",
  "open_estimate",
  "unpaid_invoice",
  "lapsed",
  "service_due",
] as const;
export type MoneyCategory = (typeof moneyCategories)[number];
export const categoryLabels: Record<MoneyCategory, string> = {
  declined: "Declined work",
  open_estimate: "Open estimates",
  unpaid_invoice: "Unpaid invoices",
  lapsed: "Not back in 6+ months",
  service_due: "Service due",
};
export type MoneyItem = {
  category: MoneyCategory;
  subjectId: string;
  customerId: string;
  vehicleId: string | null;
  serviceAssetId: string | null;
  customerName: string;
  vehicleLabel: string | null;
  phone: string | null;
  email: string | null;
  reason: string;
  amountCents: number | null;
  occurredAt: string;
  renewFirst: boolean;
  recoveryId: string | null;
  status: string;
  snoozedUntil: string | null;
  dismissedReason: string | null;
  lastContactAt: string | null;
  lastContactMethod: string | null;
};
export type MoneyCard = {
  category: MoneyCategory;
  count: number;
  knownCents: number | null;
  unknownCount: number;
  oldestAt: string | null;
};
export type MoneyDashboard = {
  cards: MoneyCard[];
  items: MoneyItem[];
  total: number;
  knownCents: number | null;
  timezone: string;
  today: string;
  hasServiceDates: boolean;
};

// All five lists use current source records, in one tenant-scoped request. Only
// workflow preferences and manual-contact evidence are stored in recovery_item.
function candidates(tx: TenantTx, now: Date) {
  return sql`WITH settings AS (
    SELECT ${now.toISOString()}::timestamptz AS as_of, timezone AS zone,
      (${now.toISOString()}::timestamptz AT TIME ZONE timezone)::date AS today
    FROM app.business WHERE id=${tx.businessId}
  ), contacts AS (
    SELECT * FROM app.customer WHERE business_id=${tx.businessId} AND status='active' AND NOT do_not_contact
  ), vehicles AS (
    SELECT *, concat_ws(' ',year,make,model,plate) AS label FROM app.vehicle
    WHERE business_id=${tx.businessId} AND status='active'
  ), service_assets AS (
    SELECT a.*,concat_ws(' · ',a.display_name,NULLIF(concat_ws(', ',
      coalesce(NULLIF(a.details->>'addressLine1',''),NULLIF(parent.details->>'addressLine1','')),
      coalesce(NULLIF(a.details->>'city',''),NULLIF(parent.details->>'city',''))),'')) AS label
    FROM app.asset a LEFT JOIN app.asset parent ON parent.business_id=a.business_id AND parent.customer_id=a.customer_id AND parent.id=a.parent_asset_id
    WHERE a.business_id=${tx.businessId} AND a.status='active' AND a.type IN ('property','equipment')
      AND (a.parent_asset_id IS NULL OR parent.status='active')
  ), balances AS (
    SELECT i.*,coalesce(p.paid,0) AS paid,p.paid_at FROM app.invoice i
    LEFT JOIN (SELECT invoice_id,sum(amount_cents) AS paid,
      max(created_at) FILTER(WHERE amount_cents>0) AS paid_at FROM app.invoice_payment
      WHERE business_id=${tx.businessId} GROUP BY invoice_id) p ON p.invoice_id=i.id
    WHERE i.business_id=${tx.businessId} AND i.voided_at IS NULL
  ), visits AS (
    SELECT *,created_at AS visit_at,row_number() OVER(PARTITION BY customer_id ORDER BY created_at DESC,id DESC) AS visit_rank
    FROM balances CROSS JOIN settings s WHERE total_cents>0 AND paid>=total_cents AND paid_at IS NOT NULL AND paid_at<=s.as_of AND created_at<=s.as_of
  ), declines AS (
    SELECT 'declined'::text AS category,coalesce(v.id,c.id) AS subject_id,c.id AS customer_id,v.id AS vehicle_id,
      c.display_name AS customer_name,v.label AS vehicle_label,c.phone_e164 AS phone,CASE WHEN c.email_opted_out_at IS NULL THEN c.email END AS email,
      'Declined work: ' || left(string_agg(r.description,'; ' ORDER BY r.declined_at DESC,r.id),500) AS reason,
      CASE WHEN bool_and(r.amount_cents IS NOT NULL) THEN sum(r.amount_cents) END AS amount_cents,
      max(r.declined_at) AS occurred_at,false AS renew_first,0::numeric AS lifetime
    FROM app.recommendation r LEFT JOIN vehicles v ON v.id=r.vehicle_id JOIN contacts c ON c.id=r.customer_id
    CROSS JOIN settings s LEFT JOIN app.recovery_item state ON state.business_id=${tx.businessId}
      AND state.category='declined' AND state.subject_id=coalesce(v.id,c.id)
    WHERE r.business_id=${tx.businessId} AND (r.vehicle_id IS NULL OR v.id IS NOT NULL) AND r.declined_at BETWEEN s.as_of-interval '18 months' AND s.as_of
      AND (r.status='open' OR (r.status='dismissed' AND state.status='dismissed'
        AND state.dismissed_recommendation_ids ? r.id::text))
    GROUP BY v.id,c.id,c.display_name,v.label,c.phone_e164,c.email,c.email_opted_out_at
  ), latest_estimates AS (
    SELECT DISTINCT ON(quote_id) * FROM app.estimate_version WHERE business_id=${tx.businessId}
    ORDER BY quote_id,version DESC
  ), open_estimates AS (
    SELECT 'open_estimate'::text AS category,e.id AS subject_id,c.id AS customer_id,v.id AS vehicle_id,
      c.display_name AS customer_name,coalesce(v.label,e.snapshot->>'serviceLabel') AS vehicle_label,c.phone_e164 AS phone,CASE WHEN c.email_opted_out_at IS NULL THEN c.email END AS email,
      'Unsigned estimate: ' || (e.snapshot->>'title') AS reason,(e.snapshot->>'subtotalCents')::numeric AS amount_cents,
      e.created_at AS occurred_at,e.expires_at<=s.as_of AS renew_first,0::numeric AS lifetime
    FROM latest_estimates e JOIN contacts c ON c.id=e.customer_id LEFT JOIN vehicles v ON v.id=e.vehicle_id CROSS JOIN settings s
    WHERE (e.vehicle_id IS NULL OR v.id IS NOT NULL) AND e.revoked_at IS NULL AND e.created_at<=s.as_of-interval '2 days' AND e.expires_at>=s.as_of-interval '60 days'
      AND NOT EXISTS(SELECT 1 FROM app.estimate_authorization a WHERE a.business_id=${tx.businessId} AND a.version_id=e.id)
  ), unpaid AS (
    SELECT 'unpaid_invoice'::text AS category,i.id AS subject_id,c.id AS customer_id,v.id AS vehicle_id,
      c.display_name AS customer_name,coalesce(v.label,i.snapshot->>'serviceLabel') AS vehicle_label,c.phone_e164 AS phone,CASE WHEN c.email_opted_out_at IS NULL THEN c.email END AS email,
      'Balance due on invoice #' || i.number::text AS reason,(i.total_cents-i.paid)::numeric AS amount_cents,
      i.created_at AS occurred_at,false AS renew_first,0::numeric AS lifetime
    FROM balances i JOIN contacts c ON c.id=i.customer_id LEFT JOIN vehicles v ON v.id=i.vehicle_id CROSS JOIN settings s
    WHERE (i.vehicle_id IS NULL OR v.id IS NOT NULL) AND i.dispute_open IS NULL AND i.total_cents>i.paid AND i.created_at<=s.as_of-interval '3 days'
  ), priority_customers AS (
    SELECT customer_id FROM declines UNION SELECT customer_id FROM open_estimates UNION SELECT customer_id FROM unpaid
  ), lapsed AS (
    SELECT 'lapsed'::text AS category,c.id AS subject_id,c.id AS customer_id,NULL::uuid AS vehicle_id,
      c.display_name AS customer_name,NULL::text AS vehicle_label,c.phone_e164 AS phone,CASE WHEN c.email_opted_out_at IS NULL THEN c.email END AS email,
      'No paid visit since ' || to_char(max(v.visit_at) AT TIME ZONE s.zone,'Mon DD, YYYY') AS reason,
      round(avg(v.total_cents) FILTER(WHERE v.visit_rank<=5)) AS amount_cents,max(v.visit_at) AS occurred_at,
      false AS renew_first,sum(v.total_cents)::numeric AS lifetime
    FROM contacts c JOIN visits v ON v.customer_id=c.id CROSS JOIN settings s
    WHERE NOT EXISTS(SELECT 1 FROM priority_customers p WHERE p.customer_id=c.id)
      AND NOT EXISTS(SELECT 1 FROM app.appointment a WHERE a.business_id=${tx.businessId} AND a.customer_id=c.id
        AND a.status='scheduled' AND a.starts_at>=s.as_of)
      AND NOT EXISTS(SELECT 1 FROM app.recovery_item r WHERE r.business_id=${tx.businessId} AND r.category='lapsed'
        AND r.customer_id=c.id AND r.last_contact_at>s.as_of-interval '90 days')
    GROUP BY c.id,c.display_name,c.phone_e164,c.email,c.email_opted_out_at,s.as_of,s.zone
    HAVING max(v.visit_at) BETWEEN s.as_of-interval '24 months' AND s.as_of-interval '6 months'
  ), service_due AS (
    SELECT 'service_due'::text AS category,v.id AS subject_id,c.id AS customer_id,v.id AS vehicle_id,
      c.display_name AS customer_name,v.label AS vehicle_label,c.phone_e164 AS phone,CASE WHEN c.email_opted_out_at IS NULL THEN c.email END AS email,
      coalesce(v.next_service_description,'Next service') || ' due ' || to_char(v.next_service_on,'Mon DD, YYYY') AS reason,
      v.next_service_amount_cents::numeric AS amount_cents,(v.next_service_on::timestamp AT TIME ZONE s.zone) AS occurred_at,
      false AS renew_first,0::numeric AS lifetime
    FROM vehicles v JOIN contacts c ON c.id=v.customer_id CROSS JOIN settings s
    WHERE v.next_service_on BETWEEN s.today-90 AND s.today+14
      AND NOT EXISTS(SELECT 1 FROM app.appointment a WHERE a.business_id=${tx.businessId} AND a.vehicle_id=v.id
        AND a.status='scheduled' AND a.starts_at>=s.as_of)
      AND NOT EXISTS(SELECT 1 FROM visits p WHERE p.vehicle_id=v.id
        AND (p.visit_at AT TIME ZONE s.zone)::date>=v.next_service_on-30)
  ), home_service_due AS (
    SELECT 'service_due'::text AS category,a.id AS subject_id,c.id AS customer_id,NULL::uuid AS vehicle_id,
      c.display_name AS customer_name,a.label AS vehicle_label,c.phone_e164 AS phone,CASE WHEN c.email_opted_out_at IS NULL THEN c.email END AS email,
      coalesce(a.next_service_description,'Next service') || ' due ' || to_char(a.next_service_on,'Mon DD, YYYY') AS reason,
      a.next_service_amount_cents::numeric AS amount_cents,(a.next_service_on::timestamp AT TIME ZONE s.zone) AS occurred_at,
      false AS renew_first,0::numeric AS lifetime
    FROM service_assets a JOIN contacts c ON c.id=a.customer_id CROSS JOIN settings s
    WHERE a.next_service_on BETWEEN s.today-90 AND s.today+14
      AND NOT EXISTS(SELECT 1 FROM app.appointment ap WHERE ap.business_id=${tx.businessId} AND ap.service_asset_id=a.id
        AND ap.status='scheduled' AND ap.starts_at>=s.as_of)
      AND NOT EXISTS(SELECT 1 FROM visits p WHERE p.service_asset_id=a.id
        AND (p.visit_at AT TIME ZONE s.zone)::date>=a.next_service_on-30)
  ), sources AS (
    SELECT * FROM declines UNION ALL SELECT * FROM open_estimates UNION ALL SELECT * FROM unpaid
    UNION ALL SELECT * FROM lapsed UNION ALL SELECT * FROM service_due UNION ALL SELECT * FROM home_service_due
  ), items AS (
    SELECT src.*,CASE
      WHEN src.category='service_due' AND src.vehicle_id IS NULL THEN src.subject_id
      WHEN src.category='open_estimate' THEN (SELECT e.service_asset_id FROM app.estimate_version e WHERE e.business_id=${tx.businessId} AND e.id=src.subject_id)
      WHEN src.category='unpaid_invoice' THEN (SELECT i.service_asset_id FROM app.invoice i WHERE i.business_id=${tx.businessId} AND i.id=src.subject_id)
      ELSE NULL::uuid END AS service_asset_id,r.id AS recovery_id,coalesce(r.status,'open') AS status,r.snoozed_until,r.dismissed_reason,
      r.last_contact_at,r.last_contact_method FROM sources src
    LEFT JOIN app.recovery_item r ON r.business_id=${tx.businessId} AND r.category=src.category AND r.subject_id=src.subject_id
  ) `;
}

function itemJson() {
  return sql`jsonb_build_object('category',category,'subjectId',subject_id,'customerId',customer_id,'vehicleId',vehicle_id,
    'serviceAssetId',service_asset_id,'customerName',customer_name,'vehicleLabel',vehicle_label,'phone',phone,'email',email,'reason',reason,
    'amountCents',amount_cents::text,'occurredAt',occurred_at,'renewFirst',renew_first,'recoveryId',recovery_id,
    'status',status,'snoozedUntil',snoozed_until,'dismissedReason',dismissed_reason,'lastContactAt',last_contact_at,
    'lastContactMethod',last_contact_method)`;
}
const safeCents = (n: unknown): number | null => {
  if (n === null || n === undefined) return null;
  const value = Number(n);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
};

export async function getMoneyFinder(
  tx: TenantTx,
  options: {
    category?: MoneyCategory;
    view?: "active" | "snoozed" | "dismissed";
    query?: string;
    page?: number;
    now?: Date;
  } = {},
): Promise<MoneyDashboard> {
  const view = options.view ?? "active",
    page = Math.max(1, Math.min(options.page ?? 1, 10000));
  const rows =
    await tx.execute(sql`${candidates(tx, options.now ?? new Date())}, active AS (
    SELECT items.* FROM items CROSS JOIN settings s WHERE status<>'dismissed' AND (snoozed_until IS NULL OR snoozed_until<=s.today)
  ), visible AS (
    SELECT items.* FROM items CROSS JOIN settings s WHERE
      (${view}='active' AND status<>'dismissed' AND (snoozed_until IS NULL OR snoozed_until<=s.today)) OR
      (${view}='snoozed' AND status<>'dismissed' AND snoozed_until>s.today) OR (${view}='dismissed' AND status='dismissed')
  ), filtered AS (
    SELECT * FROM visible WHERE (${options.category ?? null}::text IS NULL OR category=${options.category ?? null})
      AND (${options.query ?? ""}='' OR concat_ws(' ',customer_name,vehicle_label,reason) ILIKE ${`%${options.query ?? ""}%`})
  ), paged AS (
    SELECT * FROM filtered ORDER BY
      CASE WHEN category IN ('unpaid_invoice','service_due') THEN occurred_at END ASC,
      CASE WHEN category='lapsed' THEN lifetime ELSE amount_cents END DESC NULLS LAST,occurred_at DESC,subject_id
    LIMIT 50 OFFSET ${(page - 1) * 50}
  ) SELECT jsonb_build_object(
    'timezone',(SELECT zone FROM settings),'today',(SELECT today FROM settings),
    'hasServiceDates',(EXISTS(SELECT 1 FROM vehicles WHERE next_service_on IS NOT NULL) OR EXISTS(SELECT 1 FROM service_assets WHERE next_service_on IS NOT NULL)),
    'total',(SELECT count(*) FROM filtered),
    'knownCents',(SELECT coalesce(sum(amount_cents) FILTER(WHERE category<>'lapsed'),0)::text FROM active),
    'cards',coalesce((SELECT jsonb_agg(to_jsonb(card)) FROM (
      SELECT category,count(*) AS count,coalesce(sum(amount_cents),0)::text AS "knownCents",
        count(*) FILTER(WHERE amount_cents IS NULL) AS "unknownCount",min(occurred_at) AS "oldestAt"
      FROM active GROUP BY category) card),'[]'::jsonb),
    'items',coalesce((SELECT jsonb_agg(${itemJson()}) FROM paged),'[]'::jsonb)) AS data`);
  const data = rows.rows[0].data as unknown as MoneyDashboard;
  return {
    ...data,
    knownCents: safeCents(data.knownCents),
    cards: data.cards.map((c) => ({
      ...c,
      knownCents: safeCents(c.knownCents),
    })),
    items: data.items.map((i) => ({
      ...i,
      amountCents: safeCents(i.amountCents),
    })),
  };
}

async function findCandidate(
  tx: TenantTx,
  category: MoneyCategory,
  subjectId: string,
  allowRecorded = false,
) {
  const rows = await tx.execute(
    sql`${candidates(tx, new Date())} SELECT ${itemJson()} AS data FROM items WHERE category=${category} AND subject_id=${subjectId}::uuid`,
  );
  let item = rows.rows[0]?.data as unknown as MoneyItem | undefined;
  if (!item && allowRecorded) {
    const recorded =
      await tx.execute(sql`SELECT jsonb_build_object('category',r.category,'subjectId',r.subject_id,'customerId',r.customer_id,'vehicleId',r.vehicle_id,'serviceAssetId',r.service_asset_id,
    'customerName',c.display_name,'vehicleLabel',coalesce(NULLIF(concat_ws(' ',v.year,v.make,v.model,v.plate),''),sa.display_name),'phone',c.phone_e164,'email',CASE WHEN c.email_opted_out_at IS NULL THEN c.email END,'reason','Recorded manual follow-up','amountCents',NULL,'occurredAt',r.created_at,'renewFirst',false,
    'recoveryId',r.id,'status',r.status,'snoozedUntil',r.snoozed_until,'dismissedReason',r.dismissed_reason,'lastContactAt',r.last_contact_at,'lastContactMethod',r.last_contact_method) AS data
    FROM app.recovery_item r JOIN app.customer c ON c.business_id=r.business_id AND c.id=r.customer_id
    LEFT JOIN app.vehicle v ON v.business_id=r.business_id AND v.id=r.vehicle_id
    LEFT JOIN app.asset sa ON sa.business_id=r.business_id AND sa.id=r.service_asset_id
    WHERE r.business_id=${tx.businessId} AND r.category=${category} AND r.subject_id=${subjectId}::uuid
     AND c.status='active' AND NOT c.do_not_contact AND (r.vehicle_id IS NULL OR v.status='active')
     AND (r.service_asset_id IS NULL OR sa.status='active')
     AND EXISTS(SELECT 1 FROM app.activity a WHERE a.business_id=r.business_id AND a.kind='recovery.contact' AND a.data->>'recoveryItemId'=r.id::text)`);
    item = recorded.rows[0]?.data as unknown as MoneyItem | undefined;
  }
  if (!item) throw notFound("That opportunity (it may have resolved)");
  return { ...item, amountCents: safeCents(item.amountCents) };
}

export async function updateRecovery(
  tx: TenantTx,
  meta: RequestMeta,
  input: {
    category: MoneyCategory;
    subjectId: string;
    action:
      "contact" | "responded" | "booked" | "snooze" | "dismiss" | "restore";
    deliveryConfirmed?: boolean;
    method?: "phone" | "email" | "in_person" | "other";
    note?: string;
    days?: 30 | 90;
    reason?: string;
  },
) {
  await lockRevenue(tx);
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${tx.businessId}:${input.category}:${input.subjectId}`},0))`,
  );
  const source = await findCandidate(
    tx,
    input.category,
    input.subjectId,
    input.action === "responded" || input.action === "booked",
  );
  await tx
    .insert(recoveryItem)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      category: input.category,
      subjectId: input.subjectId,
      customerId: source.customerId,
      vehicleId: source.vehicleId,
      serviceAssetId: source.serviceAssetId,
    })
    .onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(recoveryItem)
    .where(
      and(
        eq(recoveryItem.businessId, tx.businessId),
        eq(recoveryItem.category, input.category),
        eq(recoveryItem.subjectId, input.subjectId),
      ),
    )
    .for("update");
  if (row.status === "dismissed" && input.action !== "restore")
    throw new AppError("INVALID_TRANSITION", "Restore this opportunity first.");
  const change: Partial<typeof recoveryItem.$inferInsert> = {};
  if (input.action === "contact") {
    if (
      !input.method ||
      (input.method === "phone" && !source.phone) ||
      (input.method === "email" && !source.email)
    )
      throw new AppError("VALIDATION", "Choose an available contact method.");
    change.status = "contacted";
    change.lastContactAt = new Date();
    change.lastContactMethod = input.method;
    change.snoozedUntil = null;
  } else if (input.action === "snooze") {
    if (![30, 90].includes(input.days ?? 0))
      throw new AppError("VALIDATION", "Choose 30 or 90 days.");
    const [b] = await tx
      .execute(sql`SELECT timezone FROM app.business WHERE id=${tx.businessId}`)
      .then((r) => r.rows);
    change.snoozedUntil = addLocalDays(
      localDateKey(new Date(), String(b.timezone)),
      input.days!,
    );
  } else if (input.action === "dismiss") {
    if (!input.reason?.trim())
      throw new AppError("VALIDATION", "Enter a dismissal reason.");
    change.status = "dismissed";
    change.dismissedReason = input.reason;
    change.snoozedUntil = null;
    if (input.category === "declined") {
      const rows = await tx
        .update(recommendation)
        .set({ status: "dismissed" })
        .where(
          and(
            eq(recommendation.businessId, tx.businessId),
            or(
              eq(recommendation.vehicleId, input.subjectId),
              and(
                sql`${recommendation.vehicleId} IS NULL`,
                eq(recommendation.customerId, input.subjectId),
              ),
            ),
            eq(recommendation.status, "open"),
          ),
        )
        .returning({ id: recommendation.id });
      change.dismissedRecommendationIds = rows.map((r) => r.id);
    }
  } else if (input.action === "restore") {
    change.status = "open";
    change.snoozedUntil = null;
    change.dismissedReason = null;
    change.dismissedRecommendationIds = [];
    if (row.dismissedRecommendationIds.length)
      await tx
        .update(recommendation)
        .set({ status: "open" })
        .where(
          and(
            eq(recommendation.businessId, tx.businessId),
            inArray(recommendation.id, row.dismissedRecommendationIds),
            eq(recommendation.status, "dismissed"),
          ),
        );
  } else {
    if (!input.note?.trim())
      throw new AppError(
        "VALIDATION",
        "Record what the customer said or the booking details.",
      );
    change.status = input.action;
  }
  await tx
    .update(recoveryItem)
    .set(change)
    .where(
      and(
        eq(recoveryItem.businessId, tx.businessId),
        eq(recoveryItem.id, row.id),
      ),
    );
  await audit(tx, meta, {
    action: `recovery.${input.action}`,
    targetType: "recovery_item",
    targetId: row.id,
    after: { ...change, note: input.note ?? null },
  });
  const priorContact =
    input.action === "responded"
      ? (
          await tx
            .select()
            .from(activity)
            .where(
              and(
                eq(activity.businessId, tx.businessId),
                eq(activity.kind, "recovery.contact"),
                sql`${activity.data}->>'recoveryItemId'=${row.id}`,
              ),
            )
            .orderBy(desc(activity.occurredAt), desc(activity.id))
            .limit(1)
        )[0]
      : undefined;
  if (input.action === "responded" && !priorContact)
    throw new AppError(
      "VALIDATION",
      "Log the manual contact before recording a response.",
    );
  const recommendationIds =
    input.action === "contact" && input.category === "declined"
      ? (
          await tx
            .select({ id: recommendation.id })
            .from(recommendation)
            .where(
              and(
                eq(recommendation.businessId, tx.businessId),
                or(
                  eq(recommendation.vehicleId, input.subjectId),
                  and(
                    sql`${recommendation.vehicleId} IS NULL`,
                    eq(recommendation.customerId, input.subjectId),
                  ),
                ),
                eq(recommendation.status, "open"),
              ),
            )
        ).map((r) => r.id)
      : [];
  const event = await recordActivity(tx, {
    kind: `recovery.${input.action}`,
    subjectType: "customer",
    subjectId: source.customerId,
    summary: `${categoryLabels[input.category]}: ${input.action === "contact" ? "manual contact recorded" : input.action}`,
    data: {
      recoveryItemId: row.id,
      category: input.category,
      subjectId: input.subjectId,
      amountCents: source.amountCents,
      method: input.method ?? null,
      note: input.note ?? null,
      deliveryConfirmed:
        input.action === "contact" && input.deliveryConfirmed === true,
      recommendationIds,
      contactActivityId: priorContact?.id ?? null,
      ownerConfirmed:
        input.action === "responded" &&
        (await currentMemberRole(tx)) === "owner",
    },
  });
  if (input.action === "responded")
    await reconcileRevenue(
      tx,
      meta,
      "Customer response recorded",
      source.customerId,
    );
  return { id: row.id, activityId: event.id };
}

export async function addRecommendation(
  tx: TenantTx,
  meta: RequestMeta,
  input: {
    customerId: string;
    vehicleId: string;
    description: string;
    amountCents: number | null;
    declinedOn: string;
  },
) {
  await getVehicle(tx, input.customerId, input.vehicleId);
  const b = await tx
    .execute(sql`SELECT timezone FROM app.business WHERE id=${tx.businessId}`)
    .then((r) => r.rows[0]);
  const zone = String(b.timezone);
  if (input.declinedOn > localDateKey(new Date(), zone))
    throw new AppError(
      "VALIDATION",
      "Declined work cannot have a future date.",
    );
  const [row] = await tx
    .insert(recommendation)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      ...input,
      declinedAt: localMidnightToUtc(input.declinedOn, zone),
    })
    .returning();
  await audit(tx, meta, {
    action: "recommendation.created",
    targetType: "recommendation",
    targetId: row.id,
    after: { description: input.description, amountCents: input.amountCents },
  });
  await recordActivity(tx, {
    kind: "recommendation.created",
    subjectType: "vehicle",
    subjectId: input.vehicleId,
    summary: `Declined work recorded: ${input.description}`,
    data: { recommendationId: row.id },
  });
  return { id: row.id };
}
export async function listRecommendations(tx: TenantTx, vehicleId: string) {
  return tx
    .select()
    .from(recommendation)
    .where(
      and(
        eq(recommendation.businessId, tx.businessId),
        eq(recommendation.vehicleId, vehicleId),
      ),
    )
    .orderBy(desc(recommendation.declinedAt))
    .limit(100);
}
export async function setRecommendationStatus(
  tx: TenantTx,
  meta: RequestMeta,
  id: string,
  status: "open" | "quoted" | "won" | "lost",
) {
  const [row] = await tx
    .update(recommendation)
    .set({ status })
    .where(
      and(
        eq(recommendation.businessId, tx.businessId),
        eq(recommendation.id, id),
      ),
    )
    .returning();
  if (!row) throw notFound("That recommendation");
  await audit(tx, meta, {
    action: "recommendation.status_changed",
    targetType: "recommendation",
    targetId: id,
    after: { status },
  });
  await recordActivity(tx, {
    kind: "recommendation.updated",
    subjectType: row.vehicleId ? "vehicle" : "customer",
    subjectId: row.vehicleId ?? row.customerId,
    summary: `Recommendation marked ${status}`,
    data: { recommendationId: id },
  });
  return { id };
}
export async function setNextService(
  tx: TenantTx,
  meta: RequestMeta,
  input: {
    customerId: string;
    vehicleId: string;
    on: string | null;
    description: string | null;
    amountCents: number | null;
  },
) {
  await getVehicle(tx, input.customerId, input.vehicleId);
  await tx
    .update(vehicle)
    .set({
      nextServiceOn: input.on,
      nextServiceDescription: input.on ? input.description : null,
      nextServiceAmountCents: input.on ? input.amountCents : null,
    })
    .where(
      and(
        eq(vehicle.businessId, tx.businessId),
        eq(vehicle.id, input.vehicleId),
      ),
    );
  await audit(tx, meta, {
    action: "vehicle.next_service_updated",
    targetType: "vehicle",
    targetId: input.vehicleId,
    after: input,
  });
  await recordActivity(tx, {
    kind: "vehicle.service_due_updated",
    subjectType: "vehicle",
    subjectId: input.vehicleId,
    summary: input.on
      ? `Next service set: ${input.on}`
      : "Next service cleared",
    data: { on: input.on },
  });
  return { id: input.vehicleId };
}
export async function setDoNotContact(
  tx: TenantTx,
  meta: RequestMeta,
  id: string,
  value: boolean,
) {
  const [row] = await tx
    .update(customer)
    .set({ doNotContact: value })
    .where(and(eq(customer.businessId, tx.businessId), eq(customer.id, id)))
    .returning();
  if (!row) throw notFound("That customer");
  await audit(tx, meta, {
    action: "customer.contact_preference",
    targetType: "customer",
    targetId: id,
    after: { doNotContact: value },
  });
  await recordActivity(tx, {
    kind: "customer.contact_preference",
    subjectType: "customer",
    subjectId: id,
    summary: value ? "Do not contact enabled" : "Do not contact cleared",
  });
  return { id };
}

export async function startRecoveryWork(
  tx: TenantTx,
  meta: RequestMeta,
  input: {
    category: MoneyCategory;
    subjectId: string;
    destination: "job" | "appointment";
  },
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${tx.businessId}:${input.category}:${input.subjectId}`},0))`,
  );
  const source = await findCandidate(tx, input.category, input.subjectId, true);
  if (source.status === "dismissed")
    throw new AppError("INVALID_TRANSITION", "Restore this opportunity first.");
  await tx
    .insert(recoveryItem)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      category: input.category,
      subjectId: input.subjectId,
      customerId: source.customerId,
      vehicleId: source.vehicleId,
      serviceAssetId: source.serviceAssetId,
    })
    .onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(recoveryItem)
    .where(
      and(
        eq(recoveryItem.businessId, tx.businessId),
        eq(recoveryItem.category, input.category),
        eq(recoveryItem.subjectId, input.subjectId),
      ),
    );
  await audit(tx, meta, {
    action: "recovery.work_started",
    targetType: "recovery_item",
    targetId: row.id,
    after: { destination: input.destination },
  });
  const contacts = await tx
    .select()
    .from(activity)
    .where(
      and(
        eq(activity.businessId, tx.businessId),
        eq(activity.kind, "recovery.contact"),
        sql`${activity.data}->>'recoveryItemId'=${row.id}`,
      ),
    )
    .orderBy(desc(activity.occurredAt), desc(activity.id));
  const responses = await tx
    .select()
    .from(activity)
    .where(
      and(
        eq(activity.businessId, tx.businessId),
        eq(activity.kind, "recovery.responded"),
        sql`${activity.data}->>'recoveryItemId'=${row.id} AND ${activity.data}->>'ownerConfirmed'='true'`,
      ),
    )
    .orderBy(desc(activity.occurredAt), desc(activity.id));
  const response = responses.find((r) =>
    contacts.some(
      (c) =>
        c.id === (r.data as Record<string, unknown>).contactActivityId &&
        r.occurredAt >= c.occurredAt &&
        r.occurredAt.getTime() - c.occurredAt.getTime() <= 30 * 86400000,
    ),
  );
  const contactId =
    ((response?.data as Record<string, unknown> | undefined)
      ?.contactActivityId as string | undefined) ?? contacts[0]?.id;
  const params = new URLSearchParams({
    sourceRecoveryItemId: row.id,
    ...(contactId ? { sourceContactActivityId: contactId } : {}),
    customerId: source.customerId,
    ...(source.vehicleId ? { vehicleId: source.vehicleId } : {}),
    ...(source.serviceAssetId ? { serviceAssetId: source.serviceAssetId } : {}),
  });
  return {
    id: row.id,
    redirectTo: `/app/${input.destination === "job" ? "jobs" : "schedule"}?${params}${input.destination === "appointment" ? "#new-appointment" : ""}`,
  };
}
