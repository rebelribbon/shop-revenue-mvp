import { expect, it } from "vitest";
import type Stripe from "stripe";
import { summarizePaymentRequirements } from "@/lib/payment-requirements";

it("shows actionable labels without exposing raw account or personal details", () => {
  const r = summarizePaymentRequirements({
    id: "acct_private",
    requirements: {
      currently_due: [
        "company.tax_id",
        "external_account",
        "individual.verification.document",
      ],
      past_due: ["external_account"],
      pending_verification: [],
      disabled_reason: "requirements.past_due",
    },
  } as unknown as Stripe.Account);
  expect(r).toEqual({
    available: true,
    due: [
      "Business tax information",
      "Bank account",
      "Identity verification document",
    ],
    pending: false,
    restricted: true,
  });
  expect(JSON.stringify(r)).not.toMatch(/acct_private|tax_id|individual\./);
});

it("distinguishes pending verification and unavailable data from a completed account", () => {
  expect(
    summarizePaymentRequirements({
      requirements: null,
    } as unknown as Stripe.Account).available,
  ).toBe(false);
  expect(
    summarizePaymentRequirements({
      requirements: {
        currently_due: [],
        pending_verification: ["company.verification.document"],
      },
    } as unknown as Stripe.Account),
  ).toMatchObject({ available: true, due: [], pending: true });
});
