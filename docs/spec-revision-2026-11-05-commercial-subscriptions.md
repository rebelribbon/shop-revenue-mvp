# Commercial subscriptions — November 5, 2026

Brad authorized public subscription sales, a trial and discount codes on November 5.
Later on November 5, Brad replaced expense-based pricing with a fixed **$49.99
per shop per month**, plus applicable taxes. The earlier three-times-expenses
rule is superseded. There is no paid advertising in the launch budget ($0/month).
Operating expenses remain a business cost and do not automatically raise the
subscription price. The 14-day card-required trial and discount codes remain.

The admin publishes a Stripe monthly USD Price with lookup key
`shop_revenue_monthly`. The price is fixed at 4999 USD cents; metadata records
`pricing_model=fixed_monthly`. Checkout and release checks reject a different
monthly amount. Publishing applies to new subscriptions; existing contracts keep
their agreed price. Discounts are product-scoped,
with a percentage, first-invoice/every-invoice duration, expiration and redemption
limit. Owners manage their cards, invoices and cancellation in Stripe's portal.

Public enrollment verifies the Supabase email identity before creating a shop.
Creation is serialized per identity, with one owner shop under concurrent retries.
Removed or suspended owner records require support rather than another signup.
Owner login MFA continues through the existing production security flow.
Checkout reserves a persisted idempotency key so repeated starts reuse one
session. A Stripe reconciliation before checkout prevents another trial or
subscription after a late lifecycle webhook. Production becomes read-only if
billing configuration is missing. Viewing and exports stay available.

Enable `PUBLIC_SIGNUP_ENABLED=true` after the release and billing checks pass.
`/pricing`, `/sign-up` and `/start` provide the public enrollment route. Set
`STRIPE_SUBSCRIPTION_LOOKUP_KEY=shop_revenue_monthly` for the release configuration
check, or retain the legacy `STRIPE_SUBSCRIPTION_PRICE_ID` fallback.

Required runtime billing secrets are `STRIPE_SECRET_KEY` (a restricted live key)
and `STRIPE_BILLING_WEBHOOK_SECRET`. Keep secrets in sensitive Vercel variables.
The account webhook goes to `https://www.shoprevenue.app/webhooks/stripe` and
subscribes to the subscription lifecycle, subscription Checkout and invoice
payment events in `SUBSCRIPTION_EVENTS`, plus `BILLING_RISK_EVENTS`. The Connect
webhook remains separately signed with `STRIPE_WEBHOOK_SECRET`. Refunds, disputes
and early fraud warnings are mapped through the Charge Customer to a shop,
recorded once in audit history, and flagged for review. They do not blindly
cancel an otherwise active subscription.

The production database still needs the pending migration chain, including 0051.
Stage and verify it with the existing release workflow and restore evidence.
Supabase Auth must allow email signup and require email confirmations. Add the
canonical `/auth/callback` return URL to its redirect allowlist. The local stack
enables confirmations and the browser test opens the actual Mailpit email.
For confirmation across browsers, the signup email template can use
`/auth/confirm?token_hash={{ .TokenHash }}&type=email` on the app origin.

The code does not supply missing branch protection, runtime role credentials,
transactional email, live Stripe key, independent review or backup evidence.
No public enrollment or production charges were activated by this revision.
Stripe Tax registration and a test calculation need verification before enabling
automatic tax for subscription sales. Signed repair authorization remains governed
by the existing legal policy system.
