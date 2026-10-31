"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineShopAction } from "./define";
import { recordJobProgress, recordJobSharing } from "@/domain/job-workflow";

const progress = defineShopAction({ name: "recordJobProgress", input: z.object({ jobId: z.uuid(), versionId: z.uuid(), expectedStatus: z.enum(["not_recorded", "in_progress", "completed"]), status: z.enum(["in_progress", "completed"]), note: z.string().max(1000) }), run: ({ tx, meta }, input) => recordJobProgress(tx, meta, input) });
const sharing = defineShopAction({ name: "recordJobSharing", input: z.object({ jobId: z.uuid(), documentId: z.uuid(), kind: z.enum(["estimate", "invoice"]) }), run: ({ tx, meta }, input) => recordJobSharing(tx, meta, input) });
export async function recordJobProgressAction(input: unknown) { const result = await progress(input); if (result.ok) revalidatePath("/app", "layout"); return result; }
export async function recordJobSharingAction(input: unknown) { const result = await sharing(input); if (result.ok) revalidatePath("/app", "layout"); return result; }
