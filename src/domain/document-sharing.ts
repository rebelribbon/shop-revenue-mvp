import { and, eq, sql, isNull } from "drizzle-orm";
import {
  business,
  customer,
  document,
  estimateVersion,
  invoice,
} from "@/db/schema";
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
    customerId,
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

export type PacketDocument = { id: string; title: string; path: string };

/** Only unsigned, active documents for the very same customer and job can
 * appear in the estimate's packet. No cross-shop or cross-job link inclusion. */
export async function getEstimatePacketDocuments(
  tx: TenantTx,
  estimateId: string,
): Promise<PacketDocument[]> {
  if (tx.actor.type !== "user")
    throw new AppError(
      "FORBIDDEN",
      "Only shop staff can prepare customer packets.",
    );
  const [estimate] = await tx
    .select({
      jobId: estimateVersion.quoteId,
      customerId: estimateVersion.customerId,
    })
    .from(estimateVersion)
    .where(
      and(
        eq(estimateVersion.businessId, tx.businessId),
        eq(estimateVersion.id, estimateId),
      ),
    );
  if (!estimate) throw notFound("That estimate");
  const rows = await tx
    .select({
      id: document.id,
      title: document.title,
      fields: document.fields,
      tokenHash: document.tokenHash,
      encrypted: document.shareTokenCiphertext,
    })
    .from(document)
    .where(
      and(
        eq(document.businessId, tx.businessId),
        eq(document.jobId, estimate.jobId),
        eq(document.customerId, estimate.customerId),
        eq(document.kind, "esign"),
        eq(document.status, "sent"),
        isNull(document.deletedAt),
        isNull(document.voidedAt),
        sql`${document.expiresAt} > now()`,
      ),
    )
    .orderBy(document.createdAt)
    .limit(8);
  const candidates: PacketDocument[] = [];
  for (const row of rows) {
    // A legacy change order where the customer sets prices is not sendable.
    if (
      row.title.trim().toLowerCase() === "change order" &&
      (row.fields ?? []).some((f) =>
        ["change", "added_cost", "cost", "price", "amount"].includes(f.key),
      )
    )
      continue;
    if (!row.encrypted || !row.tokenHash) continue;
    let token: string;
    try {
      token = openShareToken(row.encrypted);
    } catch {
      continue;
    }
    if (hashToken(token) !== row.tokenHash) continue;
    candidates.push({ id: row.id, title: row.title, path: `/sign/${token}` });
  }
  return candidates;
}

/** The one review link groups all selected secure documents without changing
 * the original immutable estimate/document evidence and signing endpoints. */
export function customerPacketPath(
  estimatePath: string,
  documents: PacketDocument[],
): string {
  const url = new URL(estimatePath, "https://internal.invalid");
  const token = url.pathname.split("/").at(-1);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new AppError("VALIDATION", "The estimate needs a new sharing link.");
  const params = new URLSearchParams({ e: token });
  for (const doc of documents)
    params.append("d", doc.path.split("/").at(-1) ?? "");
  return `/packet?${params.toString()}`;
}
