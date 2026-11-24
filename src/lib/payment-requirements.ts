import type Stripe from "stripe";

export function paymentRequirementLabel(key: string) {
  if (key.startsWith("external_account")) return "Bank account";
  if (key.startsWith("tos_acceptance")) return "Stripe service agreement";
  if (key.includes("verification.document"))
    return "Identity verification document";
  if (key.includes("tax_id")) return "Business tax information";
  if (key.includes("address")) return "Business or representative address";
  if (key === "business_profile.url") return "Business website";
  if (key.startsWith("business_profile")) return "Business details";
  if (key.startsWith("individual")) return "Account representative details";
  if (key.startsWith("company.owners") || key.startsWith("owners"))
    return "Business ownership details";
  return "Additional account verification";
}

export function summarizePaymentRequirements(account: Stripe.Account) {
  const r = account.requirements;
  return {
    available: Boolean(r),
    due: [
      ...new Set(
        [...(r?.currently_due ?? []), ...(r?.past_due ?? [])].map(
          paymentRequirementLabel,
        ),
      ),
    ],
    pending: Boolean(r?.pending_verification?.length),
    restricted: Boolean(r?.disabled_reason),
  };
}
export type PaymentRequirements = ReturnType<
  typeof summarizePaymentRequirements
>;
