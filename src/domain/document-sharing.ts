import { and, eq, sql } from "drizzle-orm";
import { customer, estimateVersion, invoice } from "@/db/schema";
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
  const [person] = await tx
    .select({
      phone: customer.phoneE164,
      email: customer.email,
      name: customer.displayName,
    })
    .from(customer)
    .where(
      and(
        eq(customer.businessId, tx.businessId),
        eq(customer.id, row.customerId),
      ),
    );
  if (!person) throw notFound("That customer");
  return { path: `/${kind}/${token}`, kind, ...person };
}
