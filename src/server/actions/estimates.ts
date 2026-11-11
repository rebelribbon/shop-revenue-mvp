"use server";
import { checkPublicThrottle } from "@/domain/public-throttle";
import { AppError } from "@/lib/errors";
import { getSessionState } from "../auth/session";
import { lineDecisionSchema, signatureSchema } from "@/lib/estimate-decisions";
import { z } from "zod";
import {
  freezeEstimate,
  revokeEstimate,
  signEstimate,
  rotateEstimateLink,
} from "@/domain/estimates";
import { handOffApprovedWork } from "@/domain/handoff-pings";
import { safeErrorDiagnostic } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { defineShopAction } from "./define";
import { getRequestMeta } from "../request";
export const freezeEstimateAction = defineShopAction({
  name: "freezeEstimate",
  input: z.object({
    jobId: z.uuid(),
    expectedJobVersion: z.uuid(),
    taxBps: z.coerce.number().int().min(0).max(2000),
    supplementReason: z.string().max(2000),
    terms: z.string().max(5000),
  }),
  run: ({ tx, meta }, i) => freezeEstimate(tx, meta, i),
  persist: (r) => ({ id: r.id, version: r.version }),
});
export const revokeEstimateAction = defineShopAction({
  name: "revokeEstimate",
  input: z.object({ id: z.uuid() }),
  run: ({ tx, meta }, i) => revokeEstimate(tx, meta, i.id),
});
export async function signEstimateAction(raw: unknown) {
  const p = z
    .object({
      token: z.string().length(43),
      name: z.string().trim().min(1).max(200),
      decisions: z.array(lineDecisionSchema).min(1).max(200),
      signature: signatureSchema,
      consent: z.literal(true),
    })
    .safeParse(raw);
  if (!p.success)
    return {
      ok: false,
      message:
        "Decide every item, draw your signature, enter your name, and confirm the authorization statement.",
    };
  try {
    const state = await getSessionState();
    if (state.kind === "shop" && state.session.actor.type === "support")
      return { ok: false, message: "View-as is read-only." };
    const meta = await getRequestMeta();
    await checkPublicThrottle("sign", p.data.token, meta.ip);
    await signEstimate(
      p.data.token,
      p.data.name,
      p.data.decisions,
      meta,
      p.data.signature,
    );
    // The signature stands whatever happens next: the approved work is handed
    // to the assigned technician, and a problem there is only logged.
    try {
      await handOffApprovedWork(p.data.token);
    } catch (error) {
      logger.warn({
        event: "estimate.sign_handoff_failed",
        ...safeErrorDiagnostic(error),
      });
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof AppError && error.code === "RATE_LIMITED")
      return { ok: false, message: error.message };
    return {
      ok: false,
      message:
        "This estimate is unavailable or already signed. Reload to check its status.",
    };
  }
}

export const rotateEstimateLinkAction = defineShopAction({
  name: "rotateEstimateLink",
  input: z.object({ id: z.uuid() }),
  run: ({ tx, meta }, i) => rotateEstimateLink(tx, meta, i.id),
  persist: (r) => ({ id: r.id }),
});
