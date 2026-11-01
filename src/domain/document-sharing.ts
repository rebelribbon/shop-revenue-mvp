import { and, eq, sql } from "drizzle-orm";
import { business, customer, estimateVersion, invoice } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { openShareToken } from "@/lib/share-token";
import { hashToken } from "@/lib/tokens";
import { AppError, notFound } from "@/lib/errors";
export async function getDocumentShare(
  tx: TenantTx,
  id: string,
  kind: "estimate" | "invoice",
) {
  if (tx.actor.type !== "user")
    throw new AppError(
      "FORBIDDEN",
      "Only signed-in shop members can share customer documents.",
    );
  const table = kind === "estimate" ? estimateVersion : invoice;
  const [row] = await tx
    .select({
      customerId: table.customerId,
      quoteId: table.quoteId,
      tokenHash: table.tokenHash,
      encrypted: table.shareTokenCiphertext,
      expiresAt: table.expiresAt,
      unavailable:
        kind === "estimate" ? estimateVersion.revokedAt : invoice.voidedAt,
    })
    .from(table)
    .where(and(eq(table.businessId, tx.businessId), eq(table.id, id)));
  if (!row || row.unavailable || row.expiresAt <= new Date())
    throw notFound("That active customer link");
  if (kind === "estimate") {
    const valid = await tx.execute(
      sql`select app.read_estimate(${row.tokenHash}) as data`,
    );
    if (!valid.rows[0]?.data)
      throw new AppError(
        "VALIDATION",
        "Update this estimate before sending it. Its approval wording needs to be brought up to date.",
        { revisionPath: `/app/jobs?edit=${row.quoteId}` },
      );
  }
  if (!row.encrypted)
    throw new AppError(
      "CONFLICT",
      "This older document needs a new sharing link. Use Replace older link below.",
      { replaceLink: true },
    );
  let token: string;
  try {
    token = openShareToken(row.encrypted);
  } catch {
    throw new AppError(
      "CONFLICT",
      "This link needs replacing before you can share it.",
      { replaceLink: true },
    );
  }
  if (hashToken(token) !== row.tokenHash)
    throw new AppError("CONFLICT", "Refresh and use the latest sharing link.");
  return {
    path: `/${kind}/${token}`,
    kind,
    ...(await shareRecipient(tx, row.customerId)),
  };
}

// Texting hours many states allow for business texts (e.g. Florida 8am-9pm).
export const QUIET_START_HOUR = 21;
export const QUIET_END_HOUR = 8;

export function inQuietHours(timeZone: string, now = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(now),
  );
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

// Who a document goes to, whether they have stopped texts or emails, and the
// sender details a message footer needs.
export async function shareRecipient(tx: TenantTx, customerId: string) {
  const [person] = await tx
    .select({
      name: customer.displayName,
      phone: customer.phoneE164,
      email: customer.email,
      textOptedOutAt: customer.textOptedOutAt,
      emailOptedOutAt: customer.emailOptedOutAt,
    })
    .from(customer)
    .where(
      and(eq(customer.businessId, tx.businessId), eq(customer.id, customerId)),
    );
  if (!person) throw notFound("That customer");
  const [b] = await tx
    .select({
      legalName: business.legalName,
      dba: business.dba,
      line1: business.addressLine1,
      city: business.city,
      region: business.region,
      postal: business.postalCode,
      timezone: business.timezone,
    })
    .from(business)
    .where(eq(business.id, tx.businessId));
  const address = b
    ? [b.line1, [b.city, b.region].filter(Boolean).join(", "), b.postal]
        .filter(Boolean)
        .join(" ")
    : "";
  return {
    name: person.name,
    phone: person.phone,
    email: person.email,
    textStoppedOn: person.textOptedOutAt?.toISOString() ?? null,
    emailStoppedOn: person.emailOptedOutAt?.toISOString() ?? null,
    senderName: b?.dba || b?.legalName || "",
    senderAddress: address,
    quietHours: b ? inQuietHours(b.timezone) : false,
  };
}

export type ShareRecipient = Awaited<ReturnType<typeof shareRecipient>>;
