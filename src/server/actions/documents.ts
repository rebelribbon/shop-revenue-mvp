"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  STARTER_TEMPLATES,
  archiveTemplate,
  fileDocument,
  listTemplates,
  prepareDocumentUpload,
  removeDocument,
  saveTemplate,
  sendDocument,
  signDocument,
  templateInput,
  voidDocument,
} from "@/domain/documents";
import { checkPublicThrottle } from "@/domain/public-throttle";
import { AppError } from "@/lib/errors";
import { signatureSchema } from "@/lib/estimate-decisions";
import { getSessionState } from "../auth/session";
import { getRequestMeta } from "../request";
import { defineShopAction } from "./define";

export const saveTemplateAction = defineShopAction({
  name: "saveDocumentTemplate",
  ownerOnly: true,
  input: templateInput,
  run: ({ tx, meta }, i) => saveTemplate(tx, meta, i),
});

export const archiveTemplateAction = defineShopAction({
  name: "archiveDocumentTemplate",
  ownerOnly: true,
  input: z.object({ templateId: z.uuid() }),
  run: ({ tx }, i) => archiveTemplate(tx, i.templateId),
  persist: () => ({ message: "Template removed." }),
});

export const addStarterTemplatesAction = defineShopAction({
  name: "addStarterTemplates",
  ownerOnly: true,
  input: z.object({}),
  run: async ({ tx, meta }) => {
    const have = new Set((await listTemplates(tx)).map((t) => t.name));
    let added = 0;
    for (const t of STARTER_TEMPLATES)
      if (!have.has(t.name)) {
        await saveTemplate(tx, meta, t);
        added++;
      }
    return {
      message: added
        ? `Added ${added} starter template${added === 1 ? "" : "s"}. Edit them to fit your business.`
        : "You already have the starter templates.",
    };
  },
});

const send = defineShopAction({
  name: "sendDocument",
  input: z.object({ jobId: z.uuid(), templateId: z.uuid() }),
  run: ({ tx, meta }, i) => sendDocument(tx, meta, i),
  persist: (r) => ({
    id: r.id,
    redirectTo: `/app/jobs?job=${r.jobId}&tab=files#file-cabinet`,
    message:
      "Document prepared and filed. Choose a recipient in the file cabinet to send the signing link.",
  }),
});
export async function sendDocumentAction(input: unknown) {
  const r = await send(input);
  if (r.ok) revalidatePath("/app/jobs");
  return r;
}

export const voidDocumentAction = defineShopAction({
  name: "voidDocument",
  input: z.object({
    documentId: z.uuid(),
    reason: z.string().max(300).optional(),
  }),
  run: ({ tx, meta }, i) =>
    voidDocument(tx, meta, i.documentId, i.reason ?? ""),
  persist: () => ({ message: "Document voided. Its history is kept." }),
});

export const prepareDocumentUploadAction = defineShopAction({
  name: "prepareDocumentUpload",
  input: z.object({
    customerId: z.uuid(),
    contentType: z.string().max(100),
    byteSize: z.number().int().positive(),
  }),
  run: ({ tx }, i) => prepareDocumentUpload(tx, i),
  persist: (r) => ({ fileId: r.fileId }),
});

const fileDoc = defineShopAction({
  name: "fileDocument",
  input: z.object({
    fileId: z.uuid(),
    customerId: z.uuid(),
    jobId: z.uuid().optional(),
    category: z.string().min(1).max(40),
    title: z.string().max(200),
  }),
  run: ({ tx, meta }, i) => fileDocument(tx, meta, i),
});
export async function fileDocumentAction(input: unknown) {
  const r = await fileDoc(input);
  if (r.ok) revalidatePath("/app", "layout");
  return r;
}

export const removeDocumentAction = defineShopAction({
  name: "removeDocument",
  input: z.object({ documentId: z.uuid() }),
  run: ({ tx }, i) => removeDocument(tx, i.documentId),
  persist: () => ({ message: "File removed." }),
});

// The customer signing from their link.
export async function signDocumentAction(raw: unknown) {
  const p = z
    .object({
      token: z.string().length(43),
      name: z.string().trim().min(1).max(200),
      values: z.record(z.string(), z.union([z.string(), z.boolean()])),
      signature: signatureSchema,
    })
    .safeParse(raw);
  if (!p.success)
    return {
      ok: false,
      message:
        "Fill in the required blanks, type your name and draw your signature.",
    };
  try {
    const state = await getSessionState();
    if (state.kind === "shop" && state.session.actor.type === "support")
      return { ok: false, message: "View-as is read-only." };
    const meta = await getRequestMeta();
    await checkPublicThrottle("sign", p.data.token, meta.ip);
    await signDocument(p.data.token, p.data, meta);
    return { ok: true };
  } catch (error) {
    if (
      error instanceof AppError &&
      (error.code === "RATE_LIMITED" || error.code === "VALIDATION")
    )
      return { ok: false, message: error.message };
    return {
      ok: false,
      message:
        "This document is unavailable or already signed. Reload to check.",
    };
  }
}
