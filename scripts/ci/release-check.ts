import {
  currentSubscriptionPrice,
  billingPortalConfiguration,
} from "../../src/domain/commercial-billing";
import { MONTHLY_PRICE_CENTS } from "../../src/lib/billing";
import { stripeClient } from "../../src/lib/stripe";
import { readFileSync } from "node:fs";
import {
  releaseConfiguration,
  stripeAccountReady,
  productionRecoveryReady,
  releaseProfileChecks,
  requiredReleaseEvidence,
} from "../../src/lib/release-readiness";
const checks = [
  ...releaseConfiguration(process.env),
  ...releaseProfileChecks(process.env),
];
let subscriptionReady = false;
let accountReady = false;
try {
  const stripe = stripeClient();
  accountReady = stripeAccountReady(await stripe.accounts.retrieve(null));
  const price = await currentSubscriptionPrice(stripe);
  subscriptionReady =
    price.livemode &&
    price.metadata.pricing_model === "fixed_monthly" &&
    price.unit_amount === MONTHLY_PRICE_CENTS &&
    Boolean(await billingPortalConfiguration(stripe));
} catch {}
checks.push({
  key: "stripe-account-activation",
  ready: accountReady,
  message:
    "Stripe business verification completed, live charges and payouts enabled, no outstanding account requirements",
});
checks.push({
  key: "subscription-catalog",
  ready: subscriptionReady,
  message:
    "Verified live $49.99 monthly subscription price, with an active billing portal",
});
checks.push({
  key: "release-commit",
  ready: /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? ""),
  message: "An exact release commit SHA is required",
});
// Staging smoke is a dependency; production smoke runs after deployment. Requiring
// production smoke before production exists would make the release gate circular.
const requiredEvidence = requiredReleaseEvidence(process.env.RELEASE_PROFILE);
let evidence: Record<
  string,
  Record<string, unknown> & {
    commit?: string;
    verifiedAt?: string;
    reference?: string;
  }
> = {};
try {
  evidence = JSON.parse(
    process.env.RELEASE_EVIDENCE_JSON ??
      readFileSync(
        process.env.RELEASE_EVIDENCE_FILE ?? "docs/release-evidence.json",
        "utf8",
      ),
  );
} catch {}
for (const key of requiredEvidence) {
  const e = evidence[key];
  checks.push({
    key,
    ready:
      !!e?.reference &&
      e.commit === process.env.GITHUB_SHA &&
      !!e.verifiedAt &&
      Date.now() - new Date(e.verifiedAt).getTime() < 7 * 86400000 &&
      new Date(e.verifiedAt).getTime() <= Date.now() + 300000 &&
      (key !== "productionRecovery" || productionRecoveryReady(e)),
    message: `Release evidence required for ${key} at the release commit`,
  });
}
console.log(
  JSON.stringify(
    {
      releaseProfile: process.env.RELEASE_PROFILE ?? "commercial",
      launchReady: checks.every((c) => c.ready),
      checks,
    },
    null,
    2,
  ),
);
if (checks.some((c) => !c.ready)) process.exitCode = 1;
