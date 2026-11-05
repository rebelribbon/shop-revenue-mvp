"use server";
import { getSessionState } from "@/server/auth/session";
import { assertSessionAssurance } from "@/server/auth/assurance";
import { getRequestMeta } from "@/server/request";
import { toActionError, type ActionResult } from "./define";
import { AppError } from "@/lib/errors";
import { safeStripeError } from "@/lib/stripe";
import { openBillingPortal, startSubscription } from "@/domain/billing";

async function ownerSession() {
  const state = await getSessionState();
  if (
    state.kind !== "shop" ||
    state.session.actor.type !== "user" ||
    state.session.role !== "owner"
  )
    throw new AppError("FORBIDDEN", "Only the shop owner can manage billing.");
  await assertSessionAssurance();
  return state.session;
}

// Starts the free trial (Stripe Checkout) or opens the billing portal.
export async function startSubscriptionAction(): Promise<
  ActionResult<{ url: string }>
> {
  const meta = await getRequestMeta();
  try {
    return {
      ok: true,
      data: await startSubscription(await ownerSession(), meta),
    };
  } catch (e) {
    return {
      ok: false,
      error: toActionError(safeStripeError(e), meta, "startSubscription"),
    };
  }
}

export async function openBillingPortalAction(): Promise<
  ActionResult<{ url: string }>
> {
  const meta = await getRequestMeta();
  try {
    return { ok: true, data: await openBillingPortal(await ownerSession()) };
  } catch (e) {
    return {
      ok: false,
      error: toActionError(safeStripeError(e), meta, "openBillingPortal"),
    };
  }
}
