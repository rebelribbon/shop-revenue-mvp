import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  activity,
  customer,
  recommendation,
  recoveryItem,
  vehicle,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import {
  outcomeLabels,
  type CallTaskOutcome,
  type TaskContact,
} from "@/lib/correspondence";
import { AppError, notFound } from "@/lib/errors";
import { addLocalDays, localDateKey, localMidnightToUtc } from "@/lib/timezone";
import {
  readFollowUpRules,
  repeatAfterDays,
  type FollowUpRules,
} from "@/lib/follow-up-rules";
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
  "new_lead",
  "job_update",
  "visit_confirm",
  "warranty_ending",
] as const;
export type MoneyCategory = (typeof moneyCategories)[number];
export const categoryLabels: Record<MoneyCategory, string> = {
  declined: "Declined work",
  open_estimate: "Open estimates",
  unpaid_invoice: "Unpaid invoices",
  lapsed: "Not back in 6+ months",
  service_due: "Service due",
  new_lead: "New leads",
  job_update: "Work updates",
  visit_confirm: "Confirm visits",
  warranty_ending: "Warranty ending",
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
function candidates(
  tx: TenantTx,
  now: Date,
  rules: FollowUpRules = readFollowUpRules({}),
) {
  const asOf = now.toISOString();
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
    WHERE ${rules.declined.on} AND r.business_id=${tx.businessId} AND (r.vehicle_id IS NULL OR v.id IS NOT NULL) AND r.declined_at BETWEEN s.as_of-interval '18 months' AND s.as_of
      AND (r.status='open' OR (r.status='dismissed' AND state.status='dismissed'
        AND state.dismissed_recommendation_ids ? r.id::text))
    GROUP BY v.id,c.id,c.display_name,v.label,c.phone_e164,c.email,c.email_opted_out_at
    HAVING max(r.declined_at)<=${asOf}::timestamptz-make_interval(days=>${rules.declined.days}::int)
  ), latest_estimates AS (
    SELECT DISTINCT ON(quote_id) * FROM app.estimate_version WHERE business_id=${tx.businessId}
    ORDER BY quote_id,version DESC
  ), open_estimates AS (
    SELECT 'open_estimate'::text AS category,e.id AS subject_id,c.id AS customer_id,v.id AS vehicle_id,
      c.display_name AS customer_name,coalesce(v.label,e.snapshot->>'serviceLabel') AS vehicle_label,c.phone_e164 AS phone,CASE WHEN c.email_opted_out_at IS NULL THEN c.email END AS email,
      'Unsigned estimate: ' || (e.snapshot->>'title') AS reason,(e.snapshot->>'subtotalCents')::numeric AS amount_cents,
      e.created_at AS occurred_at,e.expires_at<=s.as_of AS renew_first,0::numeric AS lifetime
    FROM latest_estimates e JOIN contacts c ON c.id=e.customer_id LEFT JOIN vehicles v ON v.id=e.vehicle_id CROSS JOIN settings s
    WHERE ${rules.estimate.on} AND (e.vehicle_id IS NULL OR v.id IS NOT NULL) AND e.revoked_at IS NULL AND e.created_at<=s.as_of-make_interval(days=>${rules.estimate.days}::int) AND e.expires_at>=s.as_of-interval '60 days'
      AND NOT EXISTS(SELECT 1 FROM app.estimate_authorization a WHERE a.business_id=${tx.businessId} AND a.version_id=e.id)
  ), unpaid AS (
    SELECT 'unpaid_invoice'::text AS category,i.id AS subject_id,c.id AS customer_id,v.id AS vehicle_id,
      c.display_name AS customer_name,coalesce(v.label,i.snapshot->>'serviceLabel') AS vehicle_label,c.phone_e164 AS phone,CASE WHEN c.email_opted_out_at IS NULL THEN c.email END AS email,
      'Balance due on invoice #' || i.number::text AS reason,(i.total_cents-i.paid)::numeric AS amount_cents,
      i.created_at AS occurred_at,false AS renew_first,0::numeric AS lifetime
    FROM balances i JOIN contacts c ON c.id=i.customer_id LEFT JOIN vehicles v ON v.id=i.vehicle_id CROSS JOIN settings s
    WHERE ${rules.unpaid.on} AND (i.vehicle_id IS NULL OR v.id IS NOT NULL) AND i.dispute_open IS NULL AND i.total_cents>i.paid AND i.created_at<=s.as_of-make_interval(days=>${rules.unpaid.days}::int)
  ), priority_customers AS (
    SELECT customer_id FROM declines UNION SELECT customer_id FROM open_estimates UNION SELECT customer_id FROM unpaid
  ), lapsed AS (
    SELECT 'lapsed'::text AS category,c.id AS subject_id,c.id AS customer_id,NULL::uuid AS vehicle_id,
      c.display_name AS customer_name,NULL::text AS vehicle_label,c.phone_e164 AS phone,CASE WHEN c.email_opted_out_at IS NULL THEN c.email END AS email,
      'No paid visit since ' || to_char(max(v.visit_at) AT TIME ZONE s.zone,'Mon DD, YYYY') AS reason,
      round(avg(v.total_cents) FILTER(WHERE v.visit_rank<=5)) AS amount_cents,max(v.visit_at) AS occurred_at,
      false AS renew_first,sum(v.total_cents)::numeric AS lifetime
    FROM contacts c JOIN visits v ON v.customer_id=c.id CROSS JOIN settings s
    WHERE ${rules.pastCustomer.on} AND NOT EXISTS(SELECT 1 FROM priority_customers p WHERE p.customer_id=c.id)
      AND NOT EXISTS(SELECT 1 FROM app.appointment a WHERE a.business_id=${tx.businessId} AND a.customer_id=c.id
        AND a.status='scheduled' AND a.starts_at>=s.as_of)
      AND NOT EXISTS(SELECT 1 FROM app.recovery_item r WHERE r.business_id=${tx.businessId} AND r.category='lapsed'
        AND r.customer_id=c.id AND r.last_contact_at>s.as_of-interval '90 days')
    GROUP BY c.id,c.display_name,c.phone_e164,c.email,c.email_opted_out_at,s.as_of,s.zone
    HAVING max(v.visit_at) BETWEEN s.as_of-interval '24 months' AND s.as_of-make_interval(months=>${rules.pastCustomer.months}::int)
  ), service_due AS (
    SELECT 'service_due'::text AS category,v.id AS subject_id,c.id AS customer_id,v.id AS vehicle_id,
      c.display_name AS customer_name,v.label AS vehicle_label,c.phone_e164 AS phone,CASE WHEN c.email_opted_out_at IS NULL THEN c.email END AS email,
      coalesce(v.next_service_description,'Next service') || ' due ' || to_char(v.next_service_on,'Mon DD, YYYY') AS reason,
      v.next_service_amount_cents::numeric AS amount_cents,(v.next_service_on::timestamp AT TIME ZONE s.zone) AS occurred_at,
      false AS renew_first,0::numeric AS lifetime
    FROM vehicles v JOIN contacts c ON c.id=v.customer_id CROSS JOIN settings s
    WHERE ${rules.serviceDue.on} AND v.next_service_on BETWEEN s.today-90 AND s.today+${rules.serviceDue.daysBefore}::int
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
    WHERE ${rules.serviceDue.on} AND a.next_service_on BETWEEN s.today-90 AND s.today+${rules.serviceDue.daysBefore}::int
      AND NOT EXISTS(SELECT 1 FROM app.appointment ap WHERE ap.business_id=${tx.businessId} AND ap.service_asset_id=a.id
        AND ap.status='scheduled' AND ap.starts_at>=s.as_of)
      AND NOT EXISTS(SELECT 1 FROM visits p WHERE p.service_asset_id=a.id
        AND (p.visit_at AT TIME ZONE s.zone)::date>=a.next_service_on-30)
  ), new_leads AS (
    SELECT 'new_lead'::text AS category,c.id AS subject_id,c.id AS customer_id,NULL::uuid AS vehicle_id,
      c.display_name AS customer_name,NULL::text AS vehicle_label,c.phone_e164 AS phone,CASE WHEN c.email_opted_out_at IS NULL THEN c.email END AS email,
      'New customer, no job yet' AS reason,NULL::numeric AS amount_cents,c.created_at AS occurred_at,false AS renew_first,0::numeric AS lifetime
    FROM contacts c CROSS JOIN settings s
    WHERE ${rules.newLead.on} AND c.created_at BETWEEN s.as_of-interval '90 days' AND s.as_of-make_interval(days=>${rules.newLead.days}::int)
      AND NOT EXISTS(SELECT 1 FROM app.activity a WHERE a.business_id=${tx.businessId} AND a.kind='job.costed' AND a.data->>'customerId'=c.id::text)
      AND NOT EXISTS(SELECT 1 FROM app.estimate_version e WHERE e.business_id=${tx.businessId} AND e.customer_id=c.id)
      AND NOT EXISTS(SELECT 1 FROM app.appointment a WHERE a.business_id=${tx.businessId} AND a.customer_id=c.id)
      AND NOT EXISTS(SELECT 1 FROM app.invoice i WHERE i.business_id=${tx.businessId} AND i.customer_id=c.id)
  ), job_progress AS (
    SELECT DISTINCT ON(subject_id) subject_id AS job_id,data->>'status' AS work,occurred_at FROM app.activity
    WHERE business_id=${tx.businessId} AND kind='job.progress' AND subject_type='job'
    ORDER BY subject_id,occurred_at DESC,id DESC
  ), job_updates AS (
    SELECT 'job_update'::text AS category,p.job_id AS subject_id,c.id AS customer_id,v.id AS vehicle_id,
      c.display_name AS customer_name,coalesce(v.label,e.snapshot->>'serviceLabel') AS vehicle_label,c.phone_e164 AS phone,CASE WHEN c.email_opted_out_at IS NULL THEN c.email END AS email,
      'Work in progress: ' || (e.snapshot->>'title') AS reason,NULL::numeric AS amount_cents,p.occurred_at AS occurred_at,false AS renew_first,0::numeric AS lifetime
    FROM job_progress p JOIN latest_estimates e ON e.quote_id=p.job_id JOIN contacts c ON c.id=e.customer_id
      LEFT JOIN vehicles v ON v.id=e.vehicle_id CROSS JOIN settings s
    WHERE ${rules.jobUpdate.on} AND p.work='in_progress' AND (e.vehicle_id IS NULL OR v.id IS NOT NULL)
      AND p.occurred_at<=s.as_of-make_interval(days=>${rules.jobUpdate.days}::int)
      AND NOT EXISTS(SELECT 1 FROM app.invoice i WHERE i.business_id=${tx.businessId} AND i.quote_id=p.job_id AND i.voided_at IS NULL)
  ), visit_confirms AS (
    SELECT 'visit_confirm'::text AS category,a.id AS subject_id,c.id AS customer_id,v.id AS vehicle_id,
      c.display_name AS customer_name,coalesce(v.label,sa.label) AS vehicle_label,c.phone_e164 AS phone,CASE WHEN c.email_opted_out_at IS NULL THEN c.email END AS email,
      'Visit ' || to_char(a.starts_at AT TIME ZONE s.zone,'Dy Mon FMDD at FMHH12:MI AM') || coalesce(': ' || NULLIF(a.reason,''),'') AS reason,
      NULL::numeric AS amount_cents,a.starts_at AS occurred_at,false AS renew_first,0::numeric AS lifetime
    FROM app.appointment a JOIN contacts c ON c.id=a.customer_id LEFT JOIN vehicles v ON v.id=a.vehicle_id
      LEFT JOIN service_assets sa ON sa.id=a.service_asset_id CROSS JOIN settings s
    WHERE ${rules.confirmVisit.on} AND a.business_id=${tx.businessId} AND a.status='scheduled'
      AND (a.starts_at AT TIME ZONE s.zone)::date>s.today
      AND (a.starts_at AT TIME ZONE s.zone)::date<=s.today+${rules.confirmVisit.daysBefore}::int
  ), warranties AS (
    SELECT 'warranty_ending'::text AS category,i.id AS subject_id,c.id AS customer_id,v.id AS vehicle_id,
      c.display_name AS customer_name,coalesce(v.label,i.snapshot->>'serviceLabel') AS vehicle_label,c.phone_e164 AS phone,CASE WHEN c.email_opted_out_at IS NULL THEN c.email END AS email,
      'Warranty on ' || coalesce(nullif(i.snapshot->>'title',''),'invoice #' || i.number::text) || ' ends ' ||
        to_char(((i.created_at AT TIME ZONE s.zone)::date + make_interval(months=>(i.snapshot->>'warrantyMonths')::int))::date,'Mon FMDD') AS reason,
      NULL::numeric AS amount_cents,i.created_at AS occurred_at,false AS renew_first,0::numeric AS lifetime
    FROM balances i JOIN contacts c ON c.id=i.customer_id LEFT JOIN vehicles v ON v.id=i.vehicle_id CROSS JOIN settings s
    WHERE ${rules.warranty.on} AND (i.vehicle_id IS NULL OR v.id IS NOT NULL)
      AND jsonb_typeof(i.snapshot->'warrantyMonths')='number'
      AND ((i.created_at AT TIME ZONE s.zone)::date + make_interval(months=>(i.snapshot->>'warrantyMonths')::int))::date
        BETWEEN s.today AND s.today+${rules.warranty.daysBefore}::int
  ), sources AS (
    SELECT * FROM declines UNION ALL SELECT * FROM open_estimates UNION ALL SELECT * FROM unpaid
    UNION ALL SELECT * FROM lapsed UNION ALL SELECT * FROM service_due UNION ALL SELECT * FROM home_service_due
    UNION ALL SELECT * FROM new_leads UNION ALL SELECT * FROM job_updates UNION ALL SELECT * FROM visit_confirms
    UNION ALL SELECT * FROM warranties
  ), items AS (
    SELECT src.*,CASE
      WHEN src.category='service_due' AND src.vehicle_id IS NULL THEN src.subject_id
      WHEN src.category='open_estimate' THEN (SELECT e.service_asset_id FROM app.estimate_version e WHERE e.business_id=${tx.businessId} AND e.id=src.subject_id)
      WHEN src.category IN ('unpaid_invoice','warranty_ending') THEN (SELECT i.service_asset_id FROM app.invoice i WHERE i.business_id=${tx.businessId} AND i.id=src.subject_id)
      WHEN src.category='visit_confirm' THEN (SELECT a.service_asset_id FROM app.appointment a WHERE a.business_id=${tx.businessId} AND a.id=src.subject_id)
      WHEN src.category='job_update' THEN (SELECT e.service_asset_id FROM latest_estimates e WHERE e.quote_id=src.subject_id)
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

// The shop's follow-up rules (Settings → Follow-up rules).
export async function loadFollowUpRules(tx: TenantTx) {
  const rows = await tx.execute(
    sql`SELECT follow_up_rules AS rules FROM app.business WHERE id=${tx.businessId}`,
  );
  return readFollowUpRules(rows.rows[0]?.rules);
}

export function followUpDueOn(
  item: MoneyItem,
  today: string,
  timezone: string,
  rules: FollowUpRules,
) {
  const nextAfterContact = item.lastContactAt
    ? addLocalDays(
        localDateKey(new Date(item.lastContactAt), timezone),
        repeatAfterDays(item.category, rules),
      )
    : today;
  return [today, nextAfterContact, item.snoozedUntil ?? today].reduce((a, b) =>
    a > b ? a : b,
  );
}

// Every open (not dismissed) reminder the shop's rules produce, for Tasks.
export async function listFollowUpItems(tx: TenantTx, now = new Date()) {
  const rules = await loadFollowUpRules(tx);
  const rows = await tx.execute(sql`${candidates(tx, now, rules)}
    SELECT jsonb_build_object('today',(SELECT today FROM settings),'timezone',(SELECT zone FROM settings),
      'items',coalesce((SELECT jsonb_agg(${itemJson()} || jsonb_build_object('textAllowed',text_allowed)
        ORDER BY occurred_at) FROM (
        SELECT i.*, c.text_opted_out_at IS NULL AS text_allowed
        FROM (SELECT * FROM items WHERE status<>'dismissed' LIMIT 500) i
        JOIN contacts c ON c.id=i.customer_id) available),'[]'::jsonb)) AS data`);
  const data = rows.rows[0].data as {
    today: string;
    timezone: string;
    items: (MoneyItem & { textAllowed: boolean })[];
  };
  return {
    rules,
    today: data.today,
    timezone: data.timezone,
    items: data.items.map((i) => ({
      ...i,
      amountCents: safeCents(i.amountCents),
    })),
  };
}

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
  const rules = await loadFollowUpRules(tx);
  const rows =
    await tx.execute(sql`${candidates(tx, options.now ?? new Date(), rules)}, active AS (
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
  const rules = await loadFollowUpRules(tx);
  const [candidate] = await tx
    .execute(
      sql`${candidates(tx, new Date(), rules)}
      SELECT today::text, zone, (SELECT ${itemJson()} FROM items
        WHERE category=${category} AND subject_id=${subjectId}::uuid LIMIT 1) AS data
      FROM settings`,
    )
    .then((result) => result.rows);
  let item = candidate?.data as MoneyItem | null | undefined;
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
  return {
    source: { ...item, amountCents: safeCents(item.amountCents) },
    today: String(candidate.today),
    timezone: String(candidate.zone),
    rules,
  };
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
    callOutcome?: CallTaskOutcome;
    note?: string;
    days?: 1 | 7 | 30 | 90;
    reason?: string;
    taskContact?: TaskContact;
  },
) {
  await lockRevenue(tx);
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${tx.businessId}:${input.category}:${input.subjectId}`},0))`,
  );
  const { source, today, timezone, rules } = await findCandidate(
    tx,
    input.category,
    input.subjectId,
    input.action === "responded" || input.action === "booked",
  );
  const contact = input.taskContact;
  if (contact) {
    if (
      source.customerId !== contact.customerId ||
      input.category === "unpaid_invoice"
    )
      throw notFound("That customer contact task");
    if (followUpDueOn(source, today, timezone, rules) > today)
      throw new AppError(
        "INVALID_TRANSITION",
        "This task is already scheduled for later.",
      );
  }
  if (
    input.callOutcome &&
    (input.method !== "phone" ||
      !source.phone ||
      (input.callOutcome === "reached"
        ? input.action !== "contact"
        : input.action !== "snooze" || input.days !== 1))
  )
    throw new AppError("VALIDATION", "Choose a valid call outcome.");
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
    const days = input.days ?? 0;
    if (!contact?.followUpOn && ![1, 7, 30, 90].includes(days))
      throw new AppError("VALIDATION", "Choose how long to snooze.");
    change.snoozedUntil = contact?.followUpOn ?? addLocalDays(today, days);
    if (change.snoozedUntil <= today)
      throw new AppError("VALIDATION", "Choose a date after today.");
    if (
      input.callOutcome &&
      row.snoozedUntil &&
      row.snoozedUntil >= change.snoozedUntil
    )
      throw new AppError(
        "INVALID_TRANSITION",
        "This call is already scheduled for later.",
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
  const callResult = input.callOutcome
    ? outcomeLabels[input.callOutcome] +
      (input.callOutcome === "reached" ? "" : " · try tomorrow")
    : null;
  const event = await recordActivity(tx, {
    kind: `recovery.${input.action}`,
    subjectType: "customer",
    subjectId: source.customerId,
    summary: callResult
      ? `${callResult} · ${categoryLabels[input.category]}${input.note?.trim() ? ` — ${input.note.trim()}` : ""}`
      : `${categoryLabels[input.category]} · ${input.action === "contact" ? (input.deliveryConfirmed ? "Manual contact recorded" : "Follow-up logged") : input.action}${input.note?.trim() ? ` — ${input.note.trim()}` : ""}`,
    data: {
      recoveryItemId: row.id,
      category: input.category,
      subjectId: input.subjectId,
      amountCents: source.amountCents,
      method: input.method ?? null,
      ...(input.callOutcome ? { callOutcome: input.callOutcome } : {}),
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
  const { source } = await findCandidate(
    tx,
    input.category,
    input.subjectId,
    true,
  );
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
