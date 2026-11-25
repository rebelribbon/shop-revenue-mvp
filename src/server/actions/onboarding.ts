"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import {
  updateBusinessProfile,
  getBusinessProfile,
} from "@/domain/business-profile";
import { enrollShop, shopSignupInput } from "@/domain/shop-signup";
import {
  onboardingDraft,
  readOnboarding,
  saveOnboarding,
} from "@/domain/onboarding";
import { assertSessionAssurance } from "@/server/auth/assurance";
import { getSessionState } from "@/server/auth/session";
import { supabaseServer } from "@/server/auth/supabase";
import { shopSignupEnabledFor } from "@/lib/shop-signup-access";
import { AppError } from "@/lib/errors";
import { normalizePhone } from "@/lib/normalize";
import { getRequestMeta } from "@/server/request";
import { toActionError } from "./define";
import type { AuthFormState } from "./auth";

export async function advanceOnboarding(
  _: AuthFormState | null,
  form: FormData,
): Promise<AuthFormState> {
  const meta = await getRequestMeta();
  let finish = false;
  try {
    const state = await getSessionState();
    if (state.kind === "anonymous" || !state.identity.email)
      throw new AppError("FORBIDDEN", "Sign in first.");
    await assertSessionAssurance();
    if (
      state.kind === "shop" &&
      (state.session.role !== "owner" || state.session.actor.type !== "user")
    )
      throw new AppError(
        "FORBIDDEN",
        "Only the business owner can finish setup.",
      );
    if (state.kind !== "shop" && !shopSignupEnabledFor(state.identity.email))
      throw new AppError("FORBIDDEN", "New business signup is unavailable.");
    const step = z.coerce.number().int().min(1).max(6).parse(form.get("step"));
    const version = z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(form.get("version"));
    const progress = await readOnboarding(state.identity.authSubject);
    if (progress.version !== version)
      throw new AppError(
        "CONFLICT",
        "Setup changed on another device. Reload to use your saved progress.",
      );
    if (step > progress.step || (state.kind !== "shop" && step > 2))
      throw new AppError("FORBIDDEN", "Complete your business details first.");
    const draft = { ...progress.draft };
    if (step === 1) {
      Object.assign(
        draft,
        onboardingDraft
          .pick({ businessType: true, ownerName: true, shopName: true })
          .required()
          .parse({
            businessType: form.get("businessType"),
            ownerName: form.get("ownerName"),
            shopName: form.get("shopName"),
          }),
      );
      if (!draft.ownerName || !draft.shopName)
        throw new AppError("VALIDATION", "Enter your name and business name.");
    }
    if (step === 2) {
      Object.assign(
        draft,
        onboardingDraft
          .pick({
            phone: true,
            addressLine1: true,
            city: true,
            region: true,
            postalCode: true,
            timezone: true,
          })
          .parse(
            Object.fromEntries(
              [
                "phone",
                "addressLine1",
                "city",
                "region",
                "postalCode",
                "timezone",
              ].map((k) => [k, String(form.get(k) ?? "")]),
            ),
          ),
      );
      if (!draft.businessType || !draft.ownerName || !draft.shopName)
        throw new AppError(
          "VALIDATION",
          "Choose your business type and enter your name first.",
        );
      const input = shopSignupInput.parse({
        ...draft,
        phoneE164: draft.phone ? normalizePhone(draft.phone) : undefined,
      });
      if (state.kind === "shop") {
        await withTenant(state.session.businessId, state.session.actor, (tx) =>
          updateBusinessProfile(tx, meta, {
            ...input,
            legalName: input.shopName,
            timezone: input.timezone ?? "America/Chicago",
          }),
        );
      } else {
        const { data, error } = await (await supabaseServer()).auth.getUser();
        if (
          error ||
          data.user?.id !== state.identity.authSubject ||
          !data.user.email_confirmed_at
        )
          throw new AppError(
            "FORBIDDEN",
            "Confirm your email before creating your business.",
          );
        await enrollShop(
          {
            authSubject: state.identity.authSubject,
            email: state.identity.email,
            emailVerified: true,
          },
          input,
          meta,
        );
      }
    }
    if (step === 4 && state.kind === "shop") {
      const taxPercent = z.coerce
        .number()
        .min(0)
        .max(20)
        .parse(form.get("taxPercent"));
      const laborSellRate = z.coerce
        .number()
        .min(0)
        .max(1000000)
        .parse(form.get("laborSellRate"));
      const laborCostRate = z.coerce
        .number()
        .min(0)
        .max(1000000)
        .parse(form.get("laborCostRate"));
      await withTenant(
        state.session.businessId,
        state.session.actor,
        async (tx) => {
          const p = await getBusinessProfile(tx);
          await updateBusinessProfile(tx, meta, {
            legalName: p.legalName,
            timezone: p.timezone,
            dba: p.dba,
            phoneE164: p.phoneE164,
            addressLine1: p.addressLine1,
            addressLine2: p.addressLine2,
            city: p.city,
            region: p.region,
            postalCode: p.postalCode,
            taxRateBps: Math.round(taxPercent * 100),
            laborSellRateCents: Math.round(laborSellRate * 100),
            laborCostRateCents: Math.round(laborCostRate * 100),
            partsTaxableDefault: form.get("partsTaxableDefault") === "on",
            laborTaxableDefault: form.get("laborTaxableDefault") === "on",
            taxConfirmed: form.get("taxConfirmed") === "on",
          });
        },
      );
    }
    finish = step === 6;
    await saveOnboarding(state.identity.authSubject, {
      step: Math.min(6, step + 1),
      version,
      draft,
      completed: finish,
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof z.ZodError
          ? (error.issues[0]?.message ?? "Check your business information.")
          : toActionError(error, meta, "advanceOnboarding").message,
    };
  }
  redirect(finish ? "/start?complete=1" : "/start");
}
