"use server";
import { z } from "zod";
import { getSessionState } from "../auth/session";
import { assertSessionAssurance } from "../auth/assurance";
import { withTenant } from "@/db/tenant";
import { getDocumentShare } from "@/domain/document-sharing";
import { AppError } from "@/lib/errors";
export async function prepareDocumentShare(raw: unknown) {
  const input = z
    .object({ id: z.uuid(), kind: z.enum(["estimate", "invoice"]) })
    .safeParse(raw);
  if (!input.success)
    return { ok: false as const, message: "Choose an estimate or invoice." };
  try {
    const s = await getSessionState();
    if (s.kind !== "shop" || s.session.actor.type !== "user")
      return { ok: false as const, message: "Sign in to share this document." };
    await assertSessionAssurance();
    return {
      ok: true as const,
      data: await withTenant(s.session.businessId, s.session.actor, (tx) =>
        getDocumentShare(tx, input.data.id, input.data.kind),
      ),
    };
  } catch (e) {
    return {
      ok: false as const,
      needsReplacement:
        e instanceof AppError && e.details?.replaceLink === true,
      revisionPath:
        e instanceof AppError && typeof e.details?.revisionPath === "string"
          ? e.details.revisionPath
          : undefined,
      message:
        e instanceof AppError
          ? e.message
          : "Unable to open sharing. Try again.",
    };
  }
}
