"use server";
import { z } from "zod";
import {
  configureSubscriptionPlan,
  createDiscountCode,
  discountCodeInput,
} from "@/domain/commercial-billing";
import { AppError } from "@/lib/errors";
import { safeStripeError } from "@/lib/stripe";
import { getInternalUser } from "@/server/auth/session";
import { assertSessionAssurance } from "@/server/auth/assurance";
import { getRequestMeta } from "@/server/request";
import { toActionError, type ActionResult } from "./define";

async function adminActor() {
  const me = await getInternalUser();
  if (!me || me.role !== "admin")
    throw new AppError("FORBIDDEN", "Admins only.");
  await assertSessionAssurance(me.role);
  return { internalUserId: me.id };
}
const planInput = z
  .object({
    monthlyCost: z.coerce
      .number()
      .positive()
      .max(100000)
      .refine(
        (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.000001,
        "Use at most two decimal places.",
      ),
    clientRequestId: z.uuid(),
  })
  .strict();
export async function configurePlanAction(
  raw: unknown,
): Promise<ActionResult<{ message: string }>> {
  const meta = await getRequestMeta();
  try {
    const actor = await adminActor();
    const input = planInput.parse(raw);
    return {
      ok: true,
      data: await configureSubscriptionPlan(
        actor,
        meta,
        Math.round(input.monthlyCost * 100),
        input.clientRequestId,
      ),
    };
  } catch (e) {
    return {
      ok: false,
      error: toActionError(
        safeStripeError(e),
        meta,
        "configureSubscriptionPlan",
      ),
    };
  }
}
export async function createDiscountCodeAction(
  raw: unknown,
): Promise<ActionResult<{ message: string }>> {
  const meta = await getRequestMeta();
  try {
    const actor = await adminActor();
    const input = discountCodeInput
      .extend({ clientRequestId: z.uuid() })
      .strict()
      .parse(raw);
    return {
      ok: true,
      data: await createDiscountCode(actor, meta, input, input.clientRequestId),
    };
  } catch (e) {
    return {
      ok: false,
      error: toActionError(safeStripeError(e), meta, "createDiscountCode"),
    };
  }
}
