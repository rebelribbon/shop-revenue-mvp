"use server";
import { z } from "zod";
import { cookies } from "next/headers";
import { safeStripeError } from "@/lib/stripe";
import { getSessionState } from "@/server/auth/session";
import { assertSessionAssurance } from "@/server/auth/assurance";
import { getRequestMeta } from "@/server/request";
import { toActionError, type ActionResult } from "./define";
import { AppError } from "@/lib/errors";
import {
  beginStripeConnection,
  currentStripeConnection,
} from "@/domain/stripe-connect";
import {
  stripeConnectCookieName,
  stripeConnectCookieOptions,
} from "@/lib/stripe-connect";
import {
  beginInvoiceCheckout,
  connectShop,
  reconcileShopPayments,
  requestStripeRefund,
} from "@/domain/stripe-payments";
async function shopContext(owner = false) {
  const state = await getSessionState();
  if (
    state.kind !== "shop" ||
    state.session.actor.type === "support" ||
    (owner && state.session.role !== "owner")
  )
    throw new AppError(
      "FORBIDDEN",
      owner
        ? "Only the shop owner can do this."
        : "Please sign in with a shop account.",
    );
  await assertSessionAssurance();
  return state.session;
}
export async function connectStripeAction(): Promise<
  ActionResult<{ url: string }>
> {
  const meta = await getRequestMeta();
  try {
    const shop = await shopContext(true);
    const connection = await currentStripeConnection(shop);
    if (
      connection?.accountId &&
      connection.cardPaymentsStatus !== "disconnected"
    )
      return { ok: true, data: await connectShop(shop, meta) };
    const result = await beginStripeConnection(shop, meta);
    (await cookies()).set(
      stripeConnectCookieName(),
      result.state,
      stripeConnectCookieOptions(),
    );
    return { ok: true, data: { url: result.url } };
  } catch (e) {
    return {
      ok: false,
      error: toActionError(safeStripeError(e), meta, "connectStripe"),
    };
  }
}
export async function reconcileStripeAction(): Promise<
  ActionResult<{ checked: number; message: string }>
> {
  const meta = await getRequestMeta();
  try {
    const s = await shopContext();
    const result = await reconcileShopPayments(s.businessId, meta);
    return {
      ok: true,
      data: {
        ...result,
        message: `Checked ${result.checked} online payment or refund attempts.`,
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: toActionError(safeStripeError(e), meta, "reconcileStripe"),
    };
  }
}
export async function refundStripeAction(
  raw: unknown,
): Promise<ActionResult<{ id: string; status: string | null }>> {
  const meta = await getRequestMeta();
  try {
    const s = await shopContext(true);
    const parsed = z
      .object({
        paymentId: z.uuid(),
        amountCents: z.number().int().positive().max(99999999),
        reason: z.string().trim().min(1).max(1000),
        requestId: z.uuid(),
      })
      .strict()
      .safeParse(raw);
    if (!parsed.success)
      throw new AppError(
        "VALIDATION",
        "Enter a valid refund amount and reason.",
      );
    return { ok: true, data: await requestStripeRefund(s, meta, parsed.data) };
  } catch (e) {
    return {
      ok: false,
      error: toActionError(safeStripeError(e), meta, "refundStripe"),
    };
  }
}
export async function payInvoiceAction(
  token: string,
): Promise<ActionResult<{ url?: string; paid?: boolean }>> {
  const meta = await getRequestMeta();
  try {
    const state = await getSessionState();
    if (state.kind === "shop" && state.session.actor.type === "support")
      throw new AppError("FORBIDDEN", "View-as is read-only.");
    const data = await beginInvoiceCheckout(token, meta);
    if ("checkoutId" in data && data.checkoutId) {
      const jar = await cookies();
      jar.set(`invoice_return_${data.checkoutId}`, token, {
        httpOnly: true,
        secure: !["local", "test"].includes(process.env.APP_ENV ?? "local"),
        sameSite: "lax",
        maxAge: 3600,
        path: "/payment-return",
      });
    }
    return { ok: true, data };
  } catch (e) {
    return {
      ok: false,
      error: toActionError(safeStripeError(e), meta, "payInvoice"),
    };
  }
}

export async function stripeBannerSessionAction(): Promise<
  ActionResult<{ clientSecret: string }>
> {
  const meta = await getRequestMeta();
  try {
    const shop = await shopContext(true);
    const { withTenant } = await import("@/db/tenant");
    const { getStripeConnection } = await import("@/domain/payments");
    const { stripeClient, stripeLivemode } = await import("@/lib/stripe");
    const c = await withTenant(shop.businessId, shop.actor, (tx) =>
      getStripeConnection(tx),
    );
    if (!c?.accountId || c.livemode !== stripeLivemode())
      throw new AppError("NOT_ELIGIBLE", "Connect this shop to Stripe first.");
    const session = await stripeClient().accountSessions.create({
      account: c.accountId,
      components: { notification_banner: { enabled: true } },
    });
    return { ok: true, data: { clientSecret: session.client_secret } };
  } catch (e) {
    return {
      ok: false,
      error: toActionError(safeStripeError(e), meta, "stripeBannerSession"),
    };
  }
}

export async function cancelStripeCheckoutAction(
  raw: unknown,
): Promise<ActionResult<{ message: string }>> {
  const meta = await getRequestMeta();
  try {
    const shop = await shopContext(true);
    const parsed = z.object({ id: z.uuid() }).strict().safeParse(raw);
    if (!parsed.success) throw new AppError("VALIDATION", "Invalid checkout.");
    const { cancelInvoiceCheckout } = await import("@/domain/stripe-payments");
    return {
      ok: true,
      data: await cancelInvoiceCheckout(shop, meta, parsed.data.id),
    };
  } catch (e) {
    return {
      ok: false,
      error: toActionError(safeStripeError(e), meta, "cancelStripeCheckout"),
    };
  }
}

export async function retryStripeRefundAction(
  raw: unknown,
): Promise<ActionResult<{ message: string }>> {
  const meta = await getRequestMeta();
  try {
    const shop = await shopContext(true);
    const id = z.uuid().parse(raw);
    const { withTenant } = await import("@/db/tenant");
    const { invoiceRefund } = await import("@/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const [r] = await withTenant(shop.businessId, shop.actor, (tx) =>
      tx
        .select()
        .from(invoiceRefund)
        .where(
          and(
            eq(invoiceRefund.businessId, tx.businessId),
            eq(invoiceRefund.id, id),
          ),
        ),
    );
    if (!r) throw new AppError("NOT_FOUND", "That refund was not found.");
    const result = await requestStripeRefund(shop, meta, {
      paymentId: r.paymentId,
      amountCents: r.amountCents,
      reason: r.reason,
      requestId: r.id,
    });
    return {
      ok: true,
      data: {
        message:
          result.status === "succeeded"
            ? "Refund confirmed by Stripe."
            : "Refund request checked. Refresh payment status for progress.",
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: toActionError(safeStripeError(e), meta, "retryStripeRefund"),
    };
  }
}
