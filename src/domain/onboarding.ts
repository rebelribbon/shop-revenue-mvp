import { sql } from "drizzle-orm";
import { z } from "zod";
import { withAdmin } from "@/db/admin";
import { businessTypes } from "@/lib/business-types";
import { AppError } from "@/lib/errors";

export const onboardingDraft = z
  .object({
    businessType: z.enum(businessTypes).optional(),
    ownerName: z.string().trim().max(100).optional(),
    shopName: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(40).optional(),
    addressLine1: z.string().trim().max(200).optional(),
    city: z.string().trim().max(120).optional(),
    region: z.string().trim().max(60).optional(),
    postalCode: z.string().trim().max(20).optional(),
    timezone: z
      .string()
      .max(100)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, "Choose a valid time zone.")
      .optional(),
  })
  .strict();
export type OnboardingDraft = z.infer<typeof onboardingDraft>;
export type OnboardingProgress = {
  step: number;
  version: number;
  draft: OnboardingDraft;
  completed: boolean;
};

export async function readOnboarding(
  authSubject: string,
): Promise<OnboardingProgress> {
  return withAdmin(null, async (tx) => {
    const r = await tx.execute(
      sql`select step, version, draft, completed_at from app.onboarding_progress where auth_subject = ${authSubject}::uuid`,
    );
    const row = r.rows[0];
    return {
      step: Number(row?.step ?? 1),
      version: Number(row?.version ?? 0),
      draft: onboardingDraft.parse(row?.draft ?? {}),
      completed: !!row?.completed_at,
    };
  });
}

export async function saveOnboarding(
  authSubject: string,
  input: {
    step: number;
    version: number;
    draft?: OnboardingDraft;
    completed?: boolean;
  },
) {
  const parsed = z
    .object({
      step: z.number().int().min(1).max(6),
      version: z.number().int().nonnegative(),
      draft: onboardingDraft.optional(),
      completed: z.boolean().optional(),
    })
    .strict()
    .parse(input);
  return withAdmin(null, async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"onboarding:" + authSubject}, 0))`,
    );
    const r = await tx.execute(
      sql`select version from app.onboarding_progress where auth_subject = ${authSubject}::uuid for update`,
    );
    if (Number(r.rows[0]?.version ?? 0) !== parsed.version)
      throw new AppError(
        "CONFLICT",
        "Setup changed on another device. Reload to continue from your saved progress.",
      );
    await tx.execute(
      sql`insert into app.onboarding_progress(auth_subject, step, version, draft, completed_at) values (${authSubject}::uuid, ${parsed.step}, 1, ${JSON.stringify(parsed.draft ?? {})}::jsonb, ${parsed.completed ? new Date() : null}) on conflict (auth_subject) do update set step = ${parsed.step}, version = app.onboarding_progress.version + 1, draft = app.onboarding_progress.draft || ${JSON.stringify(parsed.draft ?? {})}::jsonb, completed_at = case when ${parsed.completed === true} then now() else app.onboarding_progress.completed_at end, updated_at = now()`,
    );
    return parsed.version + 1;
  });
}
