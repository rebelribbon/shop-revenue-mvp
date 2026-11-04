// The customer link: one private link per customer. The shop copies or
// texts it; the customer sees what to approve, pay, sign and when they're
// booked — no account, no password.
import { and, eq, isNull, sql } from "drizzle-orm";
import { customerPortal } from "@/db/schema";
import { runInContext, type TenantTx } from "@/db/tenant";
import { notFound } from "@/lib/errors";
import { openShareToken, sealShareToken } from "@/lib/share-token";
import { hashToken, isWellFormedToken, newToken } from "@/lib/tokens";
import { getCustomerWithVehicles } from "./customers";
import { checkPublicThrottle } from "./public-throttle";
import { audit, type RequestMeta } from "./records";

type Raw = {
  shop: {
    name: string;
    phone: string | null;
    bookingSlug: string | null;
    timezone: string;
  };
  customer: { firstName: string; displayName: string };
  estimates: {
    id: string;
    title: string;
    totalCents: number;
    createdAt: string;
    expiresAt: string;
    sealed: string;
    approved: boolean;
  }[];
  invoices: {
    id: string;
    number: number;
    title: string;
    totalCents: number;
    paidCents: number;
    createdAt: string;
    sealed: string | null;
  }[];
  documents: {
    id: string;
    title: string;
    status: "sent" | "signed";
    sealed: string | null;
  }[];
  visits: { startsAt: string; reason: string | null }[];
};

// Turn a sealed share token back into a link path, or null if it can't be.
const link = (prefix: string, sealed: string | null) => {
  if (!sealed) return null;
  try {
    return `${prefix}/${openShareToken(sealed)}`;
  } catch {
    return null;
  }
};

export async function readCustomerPortal(token: string, ip: string | null) {
  if (!isWellFormedToken(token)) return null;
  await checkPublicThrottle("read", token, ip);
  const raw = await runInContext(
    null,
    { type: "customer", id: null },
    async (tx) => {
      const r = await tx.execute(
        sql`select app.read_customer_portal(${hashToken(token)}) as data`,
      );
      return (r.rows[0]?.data ?? null) as Raw | null;
    },
  );
  if (!raw) return null;
  return {
    shop: raw.shop,
    customer: raw.customer,
    toApprove: raw.estimates
      .filter((e) => !e.approved)
      .map((e) => ({ ...e, href: link("/estimate", e.sealed) })),
    approved: raw.estimates
      .filter((e) => e.approved)
      .map((e) => ({ ...e, href: link("/estimate", e.sealed) })),
    toPay: raw.invoices
      .filter((i) => i.totalCents - i.paidCents > 0)
      .map((i) => ({
        ...i,
        balanceCents: i.totalCents - i.paidCents,
        href: link("/invoice", i.sealed),
      })),
    paid: raw.invoices
      .filter((i) => i.totalCents - i.paidCents <= 0)
      .slice(0, 10)
      .map((i) => ({ ...i, href: link("/invoice", i.sealed) })),
    toSign: raw.documents
      .filter((d) => d.status === "sent")
      .map((d) => ({ ...d, href: link("/sign", d.sealed) })),
    visits: raw.visits,
    bookHref: raw.shop.bookingSlug ? `/book/${raw.shop.bookingSlug}` : null,
  };
}
export type CustomerPortal = NonNullable<
  Awaited<ReturnType<typeof readCustomerPortal>>
>;

// The customer's current link (path), if one exists.
export async function portalLink(tx: TenantTx, customerId: string) {
  const [row] = await tx
    .select()
    .from(customerPortal)
    .where(
      and(
        eq(customerPortal.businessId, tx.businessId),
        eq(customerPortal.customerId, customerId),
        isNull(customerPortal.revokedAt),
      ),
    );
  if (!row) return null;
  try {
    return `/c/${openShareToken(row.shareTokenCiphertext)}`;
  } catch {
    return null;
  }
}

// Make (or replace) the customer's link. Replacing stops the old one.
export async function createPortalLink(
  tx: TenantTx,
  meta: RequestMeta,
  customerId: string,
) {
  if (!(await getCustomerWithVehicles(tx, customerId)))
    throw notFound("That customer");
  await tx
    .update(customerPortal)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(customerPortal.businessId, tx.businessId),
        eq(customerPortal.customerId, customerId),
        isNull(customerPortal.revokedAt),
      ),
    );
  const t = newToken();
  const [row] = await tx
    .insert(customerPortal)
    .values({
      businessId: tx.businessId,
      createdByUserId: tx.actor.id,
      customerId,
      tokenHash: t.hash,
      shareTokenCiphertext: sealShareToken(t.token),
    })
    .returning({ id: customerPortal.id });
  await audit(tx, meta, {
    action: "customer.portal_link_created",
    targetType: "customer",
    targetId: customerId,
    after: { portalId: row.id },
  });
  return { path: `/c/${t.token}` };
}
