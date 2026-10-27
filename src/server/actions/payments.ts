"use server";
import { z } from "zod";
import { getSessionState } from "@/server/auth/session";
import { getRequestMeta } from "@/server/request";
import { toActionError, type ActionResult } from "./define";
import { AppError } from "@/lib/errors";
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
  return state.session;
}
export async function connectStripeAction(): Promise<
  ActionResult<{ url: string }>
> {
  const meta = await getRequestMeta();
  try {
    return { ok: true, data: await connectShop(await shopContext(true), meta) };
  } catch (e) {
    return { ok: false, error: toActionError(e, meta, "connectStripe") };
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
    return { ok: false, error: toActionError(e, meta, "reconcileStripe") };
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
    return { ok: false, error: toActionError(e, meta, "refundStripe") };
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
    return { ok: true, data: await beginInvoiceCheckout(token, meta) };
  } catch (e) {
    return { ok: false, error: toActionError(e, meta, "payInvoice") };
  }
}
