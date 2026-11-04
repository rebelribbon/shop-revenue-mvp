// The register: what came in today, by how it was paid, and closing out the
// cash drawer at the end of the day.
import { and, eq, sql } from "drizzle-orm";
import { registerClose } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import { localDateKey } from "@/lib/timezone";
import { audit, type RequestMeta } from "./records";

export const METHOD_LABELS: Record<string, string> = {
  stripe: "Card (online)",
  external_card: "Card (terminal)",
  cash: "Cash",
  check: "Check",
  bank_transfer: "Bank transfer",
};

async function zone(tx: TenantTx) {
  const r = await tx.execute(
    sql`SELECT timezone FROM app.business WHERE id=${tx.businessId}`,
  );
  return String(r.rows[0]?.timezone || "America/Chicago");
}

export async function registerDay(
  tx: TenantTx,
  day?: string,
  now = new Date(),
) {
  const tz = await zone(tx);
  const today = localDateKey(now, tz);
  const d = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : today;
  const rows = await tx.execute(sql`
    SELECT p.method, count(*)::int AS n, coalesce(sum(p.amount_cents),0)::bigint AS cents
    FROM app.invoice_payment p
    WHERE p.business_id=${tx.businessId}
      AND (p.created_at AT TIME ZONE ${tz})::date = ${d}::date
    GROUP BY p.method
    UNION ALL
    SELECT s.method, count(*)::int AS n, coalesce(sum(s.total_cents),0)::bigint AS cents
    FROM app.counter_sale s
    WHERE s.business_id=${tx.businessId} AND s.voided_at IS NULL
      AND (s.created_at AT TIME ZONE ${tz})::date = ${d}::date
    GROUP BY s.method`);
  // Invoice payments and quick sales, added up per method.
  const by = new Map<string, { n: number; cents: number }>();
  for (const r of rows.rows) {
    const m = String(r.method);
    const cur = by.get(m) ?? { n: 0, cents: 0 };
    by.set(m, { n: cur.n + Number(r.n), cents: cur.cents + Number(r.cents) });
  }
  const methods = Object.keys(METHOD_LABELS)
    .filter((m) => by.has(m))
    .map((m) => ({ method: m, label: METHOD_LABELS[m], ...by.get(m)! }));
  const corrections =
    (by.get("reversal")?.cents ?? 0) + (by.get("stripe_refund")?.cents ?? 0);
  const taken = methods.reduce((t, m) => t + m.cents, 0) + corrections;
  // Cash reversals take cash back out of the drawer.
  const cashBack = await tx.execute(sql`
    SELECT coalesce(sum(r.amount_cents),0)::bigint AS cents
    FROM app.invoice_payment r JOIN app.invoice_payment o
      ON o.business_id=r.business_id AND o.id=r.reverses_payment_id
    WHERE r.business_id=${tx.businessId} AND r.method='reversal' AND o.method='cash'
      AND (r.created_at AT TIME ZONE ${tz})::date = ${d}::date`);
  const cashCents =
    (by.get("cash")?.cents ?? 0) + Number(cashBack.rows[0].cents);
  const [closed] = await tx
    .select()
    .from(registerClose)
    .where(
      and(
        eq(registerClose.businessId, tx.businessId),
        eq(registerClose.day, d),
      ),
    );
  return {
    day: d,
    today,
    methods,
    corrections,
    taken,
    cashCents,
    closed: closed ?? null,
  };
}

export async function closeRegister(
  tx: TenantTx,
  meta: RequestMeta,
  input: {
    day: string;
    startingCashCents: number;
    countedCashCents: number;
    note?: string;
  },
) {
  const r = await registerDay(tx, input.day);
  if (r.closed)
    throw new AppError("CONFLICT", "This day is already closed out.");
  if (r.day > r.today)
    throw new AppError("VALIDATION", "You can’t close out a future day.");
  const [row] = await tx
    .insert(registerClose)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      day: r.day,
      startingCashCents: input.startingCashCents,
      expectedCashCents: input.startingCashCents + r.cashCents,
      countedCashCents: input.countedCashCents,
      takenCents: r.taken,
      note: input.note?.trim() || null,
    })
    .returning();
  await audit(tx, meta, {
    action: "register.closed",
    targetType: "register_close",
    targetId: row.id,
    after: {
      day: row.day,
      expected: row.expectedCashCents,
      counted: row.countedCashCents,
    },
  });
  return {
    id: row.id,
    differenceCents: row.countedCashCents - row.expectedCashCents,
  };
}
