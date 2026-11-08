"use server";
import { z } from "zod";
import { getSessionState } from "../auth/session";
import { assertSessionAssurance } from "../auth/assurance";
import { withTenant } from "@/db/tenant";
import { getDocumentShare } from "@/domain/document-sharing";
import { AppError } from "@/lib/errors";
import { emailProvider } from "@/providers/email";
import { recordActivity } from "@/domain/records";
import { and, eq } from "drizzle-orm";
import { estimateVersion, invoice } from "@/db/schema";
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


/**
 * The recipient must be provided by the shop employee; this action actually
 * submits the email to our transactional provider. A share link alone is not
 * an indication of delivery.
 */
export async function emailCustomerDocument(raw: unknown) {
  const parsed = z.object({
    id: z.uuid(),
    kind: z.enum(["estimate", "invoice"]),
    email: z.string().trim().email().max(254),
  }).safeParse(raw);
  if (!parsed.success)
    return { ok: false as const, message: "Enter a valid recipient email address." };
  try {
    const state = await getSessionState();
    if (state.kind !== "shop" || state.session.actor.type !== "user")
      return { ok: false as const, message: "Sign in as a shop member to send documents." };
    await assertSessionAssurance();
    const s = state.session;
    const recipient = await withTenant(s.businessId, s.actor, (tx) =>
      getDocumentShare(tx, parsed.data.id, parsed.data.kind),
    );
    if (recipient.emailStoppedOn)
      return { ok: false as const, message: "The customer opted out of email; do not send this document." };
    const base = process.env.APP_BASE_URL;
    if (!base || !/^https:\/\//.test(base))
      return { ok: false as const, message: "Document delivery isn't configured for this site." };

    const url = new URL(recipient.path, base).href;
    const title = parsed.data.kind === "estimate" ? "estimate for approval" : "invoice";
    const delivery = await emailProvider().send({
      to: parsed.data.email,
      subject: `${recipient.senderName || "Your shop"} — ${title}`,
      fromName: recipient.senderName,
      text: `Hello ${recipient.name},\n\n${recipient.senderName || "Your shop"} has prepared your ${title}.\n\nReview it here: ${url}\n\nIf you weren't expecting this, contact the shop directly.\n\n${recipient.senderAddress || ""}`,
    });

    // Best-effort activity record after provider acceptance. A logging failure
    // must never cause the employee to send a second copy inadvertently.
    try {
      await withTenant(s.businessId, s.actor, async (tx) => {
        const table = parsed.data.kind === "estimate" ? estimateVersion : invoice;
        const [row] = await tx
          .select({ customerId: table.customerId })
          .from(table)
          .where(and(eq(table.businessId, tx.businessId), eq(table.id, parsed.data.id)));
        if (row)
          await recordActivity(tx, {
            kind: "document.email_submitted",
            subjectType: "customer",
            subjectId: row.customerId,
            summary: `Email submitted to ${parsed.data.email}`,
            data: {
              documentId: parsed.data.id,
              documentKind: parsed.data.kind,
              providerMessageId: delivery.providerMessageId,
            },
          });
      });
    } catch {
      // The provider already acknowledged this send; don't request a retry.
    }
    return {
      ok: true as const,
      message: `Submitted to ${parsed.data.email}. Delivery/opening is not yet confirmed.`,
    };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof AppError
        ? error.message
        : "Email couldn't be sent. Open your email app or copy the link instead.",
    };
  }
}
