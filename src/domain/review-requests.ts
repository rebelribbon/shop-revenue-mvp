// Review requests: after a customer pays in full, email them the shop's
// review link. Off until the owner turns it on and adds the link; the
// owner can also ask by hand. One automatic ask per customer per 180 days.
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { business, reviewRequest } from "@/db/schema";
import { withGlobalWorker, withTenant, type TenantTx } from "@/db/tenant";
import { AppError, safeErrorDiagnostic } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { OutboundEmail } from "@/providers/email";
import { assertOwner } from "./membership";
import { deliver, shopInfo } from "./payment-reminders";
import { audit, type RequestMeta } from "./records";

const AUTO_GAP_DAYS = 180;
const MANUAL_GAP_DAYS = 30;

export const reviewSettings = z.object({
  on: z.boolean().default(false),
  link: z
    .string()
    .trim()
    .max(500)
    .refine(
      (v) => v === "" || /^https:\/\/[^\s]+$/i.test(v),
      "Paste the full link, starting with https://",
    )
    .default(""),
});
export type ReviewSettings = z.infer<typeof reviewSettings>;

export async function readReviewSettings(tx: TenantTx) {
  const [row] = await tx
    .select({ v: business.reviewRequests })
    .from(business)
    .where(eq(business.id, tx.businessId));
  const parsed = reviewSettings.safeParse(row?.v ?? {});
  return parsed.success ? parsed.data : reviewSettings.parse({});
}

export async function saveReviewSettings(
  tx: TenantTx,
  meta: RequestMeta,
  input: ReviewSettings,
) {
  await assertOwner(tx);
  const value = reviewSettings.parse(input);
  if (value.on && !value.link)
    throw new AppError(
      "VALIDATION",
      "Add your review link first, then turn this on.",
    );
  await tx
    .update(business)
    .set({ reviewRequests: value })
    .where(eq(business.id, tx.businessId));
  await audit(tx, meta, {
    action: "review_requests.saved",
    targetType: "business",
    targetId: tx.businessId,
    after: value,
  });
  return value;
}

type Target = {
  customerId: string;
  invoiceId: string | null;
  email: string | null;
  optedOut: boolean;
  firstName: string;
  lastAskedAt: Date | null;
};

async function target(
  tx: TenantTx,
  customerId: string,
  invoiceId: string | null,
) {
  const r = await tx.execute(sql`
    SELECT c.id, c.email, c.email_opted_out_at IS NOT NULL AS opted_out, c.first_name,
      (SELECT max(rr.created_at) FROM app.review_request rr WHERE rr.business_id=c.business_id
        AND rr.customer_id=c.id AND rr.status='sent') AS last_asked
    FROM app.customer c WHERE c.business_id=${tx.businessId} AND c.id=${customerId} AND c.status='active'`);
  const x = r.rows[0];
  if (!x) return null;
  return {
    customerId,
    invoiceId,
    email: (x.email as string | null) ?? null,
    optedOut: Boolean(x.opted_out),
    firstName: String(x.first_name ?? ""),
    lastAskedAt: x.last_asked ? new Date(x.last_asked as string) : null,
  } satisfies Target;
}

function compose(
  t: Target,
  shop: Awaited<ReturnType<typeof shopInfo>>,
  link: string,
): OutboundEmail {
  return {
    to: t.email!,
    subject: `How did we do, ${t.firstName || "friend"}?`,
    text: [
      `Hi ${t.firstName || "there"},`,
      "",
      `Thanks for choosing ${shop.name}. If you have a minute, a quick review helps a small business like ours more than you’d think:`,
      "",
      link,
      "",
      "If anything wasn’t right, just reply to this email and we’ll make it right.",
      "",
      shop.name,
    ].join("\n"),
    fromName: shop.name,
    replyTo: shop.ownerEmail ?? undefined,
    metadata: { kind: "review_request", customerId: t.customerId },
  };
}

export type PreparedReview = {
  customerId: string;
  invoiceId: string | null;
  email: OutboundEmail;
};

const DAY = 86400000;

// "Ask for a review" by hand. Step 1 (inside the action's transaction).
export async function prepareReviewNow(
  tx: TenantTx,
  input: { customerId?: string; invoiceId?: string },
): Promise<PreparedReview> {
  const settings = await readReviewSettings(tx);
  if (!settings.link)
    throw new AppError(
      "NOT_ELIGIBLE",
      "Add your review link in Settings → Follow-up rules first.",
    );
  let customerId = input.customerId ?? null;
  if (input.invoiceId) {
    const r = await tx.execute(
      sql`SELECT customer_id FROM app.invoice WHERE business_id=${tx.businessId} AND id=${input.invoiceId}`,
    );
    customerId = r.rows[0] ? String(r.rows[0].customer_id) : null;
  }
  const t = customerId
    ? await target(tx, customerId, input.invoiceId ?? null)
    : null;
  if (!t) throw new AppError("NOT_FOUND", "That customer was not found.");
  if (!t.email)
    throw new AppError("VALIDATION", "Add the customer’s email first.");
  if (t.optedOut)
    throw new AppError(
      "NOT_ELIGIBLE",
      "This customer asked not to get emails.",
    );
  if (
    t.lastAskedAt &&
    Date.now() - t.lastAskedAt.getTime() < MANUAL_GAP_DAYS * DAY
  )
    throw new AppError(
      "NOT_ELIGIBLE",
      `You asked this customer for a review on ${t.lastAskedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Give it a few weeks.`,
    );
  return {
    customerId: t.customerId,
    invoiceId: t.invoiceId,
    email: compose(t, await shopInfo(tx), settings.link),
  };
}

async function record(
  tx: TenantTx,
  p: PreparedReview,
  outcome: { status: "sent" | "failed"; providerMessageId?: string },
  automatic: boolean,
) {
  await tx.insert(reviewRequest).values({
    businessId: tx.businessId,
    createdByUserId: tx.actor.type === "user" ? tx.actor.id : null,
    customerId: p.customerId,
    invoiceId: p.invoiceId,
    sentTo: p.email.to,
    status: outcome.status,
    automatic,
    providerMessageId: outcome.providerMessageId ?? null,
  });
}

// Step 2 (after commit).
export async function sendPreparedReview(
  businessId: string,
  actor: Parameters<typeof withTenant>[1],
  p: PreparedReview,
) {
  const outcome = await deliver(p);
  await withTenant(businessId, actor, (tx) => record(tx, p, outcome, false));
  return {
    status: outcome.status,
    message:
      outcome.status === "sent"
        ? `Review request emailed to ${p.email.to}.`
        : "The email couldn’t be sent right now. Try again in a few minutes.",
  };
}

export async function lastReviewRequest(tx: TenantTx, customerId: string) {
  const [row] = await tx
    .select()
    .from(reviewRequest)
    .where(
      and(
        eq(reviewRequest.businessId, tx.businessId),
        eq(reviewRequest.customerId, customerId),
      ),
    )
    .orderBy(desc(reviewRequest.createdAt))
    .limit(1);
  return row ?? null;
}

// The daily job: customers who paid an invoice in full in the last 3 days.
export async function runReviewRequests(now = new Date()) {
  const ids = await withGlobalWorker(async (tx) => {
    const r = await tx.execute(
      sql`select app.review_request_businesses() as id`,
    );
    return r.rows.map((x) => String(x.id));
  });
  let sent = 0,
    failed = 0,
    errors = 0;
  const system = { type: "system" as const, id: null };
  for (const businessId of ids) {
    try {
      const prepared = await withTenant(
        businessId,
        system,
        async (tx) => {
          const settings = await readReviewSettings(tx);
          if (!settings.on || !settings.link) return [];
          const shop = await shopInfo(tx);
          const since = new Date(now.getTime() - 3 * DAY);
          const r = await tx.execute(sql`
            SELECT DISTINCT ON (i.customer_id) i.customer_id, i.id
            FROM app.invoice i
            WHERE i.business_id=${tx.businessId} AND i.voided_at IS NULL
              AND i.total_cents <= (SELECT coalesce(sum(p.amount_cents),0) FROM app.invoice_payment p
                WHERE p.business_id=i.business_id AND p.invoice_id=i.id)
              AND (SELECT max(p.created_at) FROM app.invoice_payment p
                WHERE p.business_id=i.business_id AND p.invoice_id=i.id AND p.amount_cents>0) >= ${since}
            ORDER BY i.customer_id, i.created_at DESC`);
          const out: PreparedReview[] = [];
          for (const row of r.rows) {
            const t = await target(tx, String(row.customer_id), String(row.id));
            if (!t || !t.email || t.optedOut) continue;
            if (
              t.lastAskedAt &&
              now.getTime() - t.lastAskedAt.getTime() < AUTO_GAP_DAYS * DAY
            )
              continue;
            out.push({
              customerId: t.customerId,
              invoiceId: t.invoiceId,
              email: compose(t, shop, settings.link),
            });
          }
          return out;
        },
        { role: "app" },
      );
      for (const p of prepared) {
        const outcome = await deliver(p);
        await withTenant(
          businessId,
          system,
          (tx) => record(tx, p, outcome, true),
          { role: "app" },
        );
        if (outcome.status === "sent") sent++;
        else failed++;
      }
    } catch (error) {
      errors++;
      logger.error({
        event: "review_requests.business_failed",
        businessId,
        requestId: `reviews-${randomUUID()}`,
        ...safeErrorDiagnostic(error),
      });
    }
  }
  return { sent, failed, errors };
}
