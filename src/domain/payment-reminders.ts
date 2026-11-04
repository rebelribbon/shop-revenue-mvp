// Payment reminders: an email with the pay link for every open invoice,
// every few days once it's due. Off until the owner turns it on; the owner
// can also send one by hand. Emails go out after the database work commits,
// and every attempt (sent or failed) is recorded on the invoice.
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { business, paymentReminder } from "@/db/schema";
import { withGlobalWorker, withTenant, type TenantTx } from "@/db/tenant";
import { AppError, safeErrorDiagnostic } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { openShareToken } from "@/lib/share-token";
import { addLocalDays, localDateKey } from "@/lib/timezone";
import { emailProvider, type OutboundEmail } from "@/providers/email";
import { rotateInvoiceLink } from "./invoices";
import { assertOwner } from "./membership";
import { audit, type RequestMeta } from "./records";

// Stop after this many automatic reminders; the call task keeps going.
export const MAX_AUTOMATIC = 5;

export const reminderSettings = z.object({
  on: z.boolean().default(false),
  everyDays: z.number().int().min(1).max(30).default(3),
});
export type ReminderSettings = z.infer<typeof reminderSettings>;

export async function readReminderSettings(tx: TenantTx) {
  const [row] = await tx
    .select({ v: business.paymentReminders })
    .from(business)
    .where(eq(business.id, tx.businessId));
  const parsed = reminderSettings.safeParse(row?.v ?? {});
  return parsed.success ? parsed.data : reminderSettings.parse({});
}

export async function saveReminderSettings(
  tx: TenantTx,
  meta: RequestMeta,
  input: ReminderSettings,
) {
  await assertOwner(tx);
  const value = reminderSettings.parse(input);
  await tx
    .update(business)
    .set({ paymentReminders: value })
    .where(eq(business.id, tx.businessId));
  await audit(tx, meta, {
    action: "payment_reminders.saved",
    targetType: "business",
    targetId: tx.businessId,
    after: value,
  });
  return value;
}

type OpenInvoice = {
  id: string;
  number: number;
  title: string;
  balanceCents: number;
  dueOn: string | null;
  createdAt: Date;
  expiresAt: Date;
  sealed: string | null;
  email: string | null;
  optedOut: boolean;
  firstName: string;
  sentCount: number;
  lastSentAt: Date | null;
};

async function openInvoices(tx: TenantTx, invoiceId?: string) {
  const r = await tx.execute(sql`
    SELECT i.id, i.number, coalesce(i.snapshot->>'title','') AS title,
      i.total_cents - coalesce((SELECT sum(p.amount_cents) FROM app.invoice_payment p
        WHERE p.business_id=i.business_id AND p.invoice_id=i.id),0) AS balance,
      i.due_on::text AS due_on, i.created_at, i.expires_at, i.share_token_ciphertext AS sealed,
      c.email, c.email_opted_out_at IS NOT NULL AS opted_out, c.first_name,
      (SELECT count(*) FROM app.payment_reminder r WHERE r.business_id=i.business_id
        AND r.invoice_id=i.id AND r.status='sent' AND r.automatic) AS sent_count,
      (SELECT max(r.created_at) FROM app.payment_reminder r WHERE r.business_id=i.business_id
        AND r.invoice_id=i.id AND r.status='sent') AS last_sent
    FROM app.invoice i
    JOIN app.customer c ON c.business_id=i.business_id AND c.id=i.customer_id
    WHERE i.business_id=${tx.businessId} AND i.voided_at IS NULL AND c.status='active'
      ${invoiceId ? sql`AND i.id=${invoiceId}` : sql``}`);
  return r.rows
    .map((x): OpenInvoice => ({
      id: String(x.id),
      number: Number(x.number),
      title: String(x.title),
      balanceCents: Number(x.balance),
      dueOn: (x.due_on as string | null) ?? null,
      createdAt: new Date(x.created_at as string),
      expiresAt: new Date(x.expires_at as string),
      sealed: (x.sealed as string | null) ?? null,
      email: (x.email as string | null) ?? null,
      optedOut: Boolean(x.opted_out),
      firstName: String(x.first_name ?? ""),
      sentCount: Number(x.sent_count),
      lastSentAt: x.last_sent ? new Date(x.last_sent as string) : null,
    }))
    .filter((i) => i.balanceCents > 0);
}

// Which open invoices get an automatic reminder today.
export function isDue(
  inv: OpenInvoice,
  settings: ReminderSettings,
  today: string,
  timezone: string,
) {
  if (!inv.email || inv.optedOut || inv.sentCount >= MAX_AUTOMATIC)
    return false;
  // No due date: first reminder a few days after it was issued.
  const due =
    inv.dueOn ??
    addLocalDays(localDateKey(inv.createdAt, timezone), settings.everyDays);
  if (today < due) return false;
  if (!inv.lastSentAt) return true;
  return (
    today >=
    addLocalDays(localDateKey(inv.lastSentAt, timezone), settings.everyDays)
  );
}

const money = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    c / 100,
  );

function appUrl(path: string) {
  const base = process.env.APP_BASE_URL;
  if (!base)
    throw new AppError(
      "PROVIDER_UNAVAILABLE",
      "APP_BASE_URL is not configured.",
    );
  return `${base.replace(/\/$/, "")}${path}`;
}

async function shopInfo(tx: TenantTx) {
  const r = await tx.execute(sql`
    SELECT coalesce(nullif(b.dba,''),b.legal_name) AS name, b.phone_e164 AS phone, b.timezone,
      (SELECT u.email FROM app.membership m JOIN app."user" u ON u.id=m.user_id
        WHERE m.business_id=b.id AND m.role='owner' AND m.status='active' LIMIT 1) AS owner_email
    FROM app.business b WHERE b.id=${tx.businessId}`);
  const row = r.rows[0];
  return {
    name: String(row?.name ?? "Your shop"),
    phone: (row?.phone as string | null) ?? null,
    timezone: String(row?.timezone ?? "America/Chicago"),
    ownerEmail: (row?.owner_email as string | null) ?? null,
  };
}

export type PreparedReminder = {
  invoiceId: string;
  email: OutboundEmail;
};

// Builds the email (and a fresh pay link if the old one expired). Runs in
// the transaction; sending happens after it commits.
async function prepare(
  tx: TenantTx,
  meta: RequestMeta,
  inv: OpenInvoice,
  shop: Awaited<ReturnType<typeof shopInfo>>,
): Promise<PreparedReminder> {
  let path: string | null = null;
  if (inv.sealed && inv.expiresAt > new Date()) {
    try {
      path = `/invoice/${openShareToken(inv.sealed)}`;
    } catch {
      path = null;
    }
  }
  if (!path) path = (await rotateInvoiceLink(tx, meta, inv.id)).path;
  const dueText = inv.dueOn
    ? ` (due ${new Date(`${inv.dueOn}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric" })})`
    : "";
  const lines = [
    `Hi ${inv.firstName || "there"},`,
    "",
    `This is a friendly reminder that invoice #${inv.number}${inv.title ? ` for ${inv.title}` : ""} has ${money(inv.balanceCents)} still due${dueText}.`,
    "",
    `Pay online: ${appUrl(path)}`,
    "",
    shop.phone
      ? `Questions? Call us at ${shop.phone} or reply to this email.`
      : "Questions? Reply to this email.",
    "",
    shop.name,
  ];
  return {
    invoiceId: inv.id,
    email: {
      to: inv.email!,
      subject: `Reminder: ${shop.name} invoice #${inv.number}, ${money(inv.balanceCents)} due`,
      text: lines.join("\n"),
      fromName: shop.name,
      replyTo: shop.ownerEmail ?? undefined,
      metadata: { kind: "payment_reminder", invoiceId: inv.id },
    },
  };
}

async function record(
  tx: TenantTx,
  p: PreparedReminder,
  outcome: { status: "sent" | "failed"; providerMessageId?: string },
  automatic: boolean,
) {
  await tx.insert(paymentReminder).values({
    businessId: tx.businessId,
    createdByUserId: tx.actor.type === "user" ? tx.actor.id : null,
    invoiceId: p.invoiceId,
    sentTo: p.email.to,
    status: outcome.status,
    automatic,
    providerMessageId: outcome.providerMessageId ?? null,
  });
}

async function deliver(p: PreparedReminder) {
  try {
    const r = await emailProvider().send(p.email);
    return { status: "sent" as const, providerMessageId: r.providerMessageId };
  } catch (error) {
    logger.warn({
      event: "payment_reminder.failed",
      invoiceId: p.invoiceId,
      ...safeErrorDiagnostic(error),
    });
    return { status: "failed" as const };
  }
}

// "Email a reminder" on one invoice. Step 1 (in the action's transaction).
export async function prepareReminderNow(
  tx: TenantTx,
  meta: RequestMeta,
  invoiceId: string,
) {
  const [inv] = await openInvoices(tx, invoiceId);
  if (!inv)
    throw new AppError("INVALID_TRANSITION", "This invoice is already paid.");
  if (!inv.email)
    throw new AppError(
      "VALIDATION",
      "Add the customer’s email first, or text them the pay link.",
    );
  if (inv.optedOut)
    throw new AppError(
      "NOT_ELIGIBLE",
      "This customer asked not to get emails. Call or text them instead.",
    );
  return prepare(tx, meta, inv, await shopInfo(tx));
}

// Step 2 (after commit): send, then record the outcome.
export async function sendPreparedReminder(
  businessId: string,
  actor: Parameters<typeof withTenant>[1],
  p: PreparedReminder,
) {
  const outcome = await deliver(p);
  await withTenant(businessId, actor, (tx) => record(tx, p, outcome, false));
  return {
    status: outcome.status,
    message:
      outcome.status === "sent"
        ? `Reminder emailed to ${p.email.to}.`
        : "The reminder couldn’t be sent right now. Try again in a few minutes.",
  };
}

export async function reminderHistory(tx: TenantTx, invoiceId: string) {
  if (!z.uuid().safeParse(invoiceId).success) return [];
  return tx
    .select()
    .from(paymentReminder)
    .where(
      and(
        eq(paymentReminder.businessId, tx.businessId),
        eq(paymentReminder.invoiceId, invoiceId),
      ),
    )
    .orderBy(desc(paymentReminder.createdAt))
    .limit(20);
}

// The daily job: every shop with reminders on.
export async function runPaymentReminders(now = new Date()) {
  const ids = await withGlobalWorker(async (tx) => {
    const r = await tx.execute(
      sql`select app.payment_reminder_businesses() as id`,
    );
    return r.rows.map((x) => String(x.id));
  });
  // failed = emails the provider refused; errors = a shop's run broke.
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
          const settings = await readReminderSettings(tx);
          if (!settings.on) return [];
          const shop = await shopInfo(tx);
          const today = localDateKey(now, shop.timezone);
          const meta = { requestId: `reminders-${randomUUID()}`, ip: null };
          const out: PreparedReminder[] = [];
          for (const inv of await openInvoices(tx))
            if (isDue(inv, settings, today, shop.timezone))
              out.push(await prepare(tx, meta, inv, shop));
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
        event: "payment_reminders.business_failed",
        businessId,
        ...safeErrorDiagnostic(error),
      });
    }
  }
  return { sent, failed, errors };
}
