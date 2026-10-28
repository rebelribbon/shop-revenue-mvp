# M4 payments: integration and verification

Implemented on `m4-invoices-payments`:

- Shop-owned Accounts v2 merchant accounts with a full Stripe Dashboard, direct charges, Stripe fee collection and Stripe loss liability. No application transaction fee.
- Hosted onboarding and authenticated, owner-only notification-banner sessions. Account details and payment credentials never enter the application database or logs.
- Stable checkout return URLs with short-lived, HttpOnly per-attempt return cookies; invoice link rotation does not change Stripe idempotency parameters. Return pages never declare a payment successful.
- Invoice-token checkout, USD balances in integer cents, server-side capability checks, stable provider idempotency, and one active checkout per invoice.
- Signed webhook ingestion before processing. Payment processing occurs before acknowledgement; failures return 503 for Stripe retry even without a hosted queue worker. Queue workers register the same idempotent handlers.
- Amount, currency, account, invoice, checkout and mode verification against the provider's current Checkout session. Return URLs never mark invoices paid. Duplicate and out-of-order notifications preserve one ledger entry per provider payment/refund.
- Owner-only partial/full refund requests with durable identity and provider idempotency. Pending refunds preserve the current paid balance; only confirmed successes append a negative entry. Manual corrections cannot reverse Stripe payments.
- Tenant-isolated, forced-RLS payment tables. Active online attempts block manual money changes and invoice voids; owners can expire an unpaid Checkout session after Stripe confirms its status.
- Status refresh reconciles active attempts, requested refunds, and refunds on the most recent 100 online payments, including refunds initiated in Stripe Dashboard. A network timeout retains the reservation until the provider's result is known. Owners can safely retry an uncertain refund using its original request identity.

## Environment configuration

Use the separate claimed Shop Revenue sandbox, never the Rebel Ribbon account. Keep the sandbox runtime key and webhook signing secret in Vercel sensitive environment variables, scoped to the preview target. This Vercel project is deployed through CLI and has no Git integration, so Vercel rejects branch-scoped environment variables. The M4 workflow assigns its tested deployment to a dedicated stable preview alias; production variables remain separate. Do not use CLI OAuth access/refresh tokens as deployed application credentials.

- `STRIPE_SECRET_KEY`: restricted sandbox application API key. Permit the required Accounts v2 merchant create/retrieve, account link/session creation, connected-account Checkout Session create/read/expire, PaymentIntent read and Refund create/read operations. Grant the corresponding connected-account access. Webhook endpoint setup permissions belong on a separate setup credential, rather than the runtime key.
- `STRIPE_PUBLISHABLE_KEY`: sandbox publishable key for the account-requirements banner.
- `STRIPE_WEBHOOK_SECRET`: signing secret for the Connect webhook endpoint.
- `PAYMENTS_BASE_URL`: stable HTTPS branch-preview origin used for onboarding and Checkout return URLs. Never infer a trusted origin from request headers. The M4 preview uses `https://shop-revenue-m4-preview-brads-projects-3548d304.vercel.app`; alias assignment happens only after exact-deployment smoke checks pass.

Enable a Connect webhook endpoint for snapshot events on connected accounts:

```
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
refund.created
refund.updated
refund.failed
account.updated
```

The application route is `/webhooks/stripe`. Protected Vercel previews require the documented automation-bypass query parameter on this provider-only webhook destination; keep its value secret and out of source, logs, documentation, and customer links. Do not disable Deployment Protection globally. Verify delivery against the exact deployed branch origin. The webhook must reach the application rather than Vercel's login page.

## Required provider verification before declaring M4 complete

The implementation has database-backed tests using synthetic Stripe objects and mocked provider transport. Those tests do not establish that the sandbox platform is enabled for Connect, that restricted API permissions are sufficient, or that Stripe can deliver to the protected preview.

1. With explicit authorization for creation, create a sandbox-only test merchant using synthetic details and complete Stripe's hosted test onboarding. Confirm the v2 `configuration.merchant.capabilities.card_payments.status` is `active`.
2. Configure the branch's application credentials and webhook destination; deploy the resulting configuration. Keep all production resources unchanged.
3. Pay a real sandbox invoice through hosted Checkout. Verify the actual signed delivery records a single payment and that replay changes no totals.
4. Test failed and asynchronous payments, cancel/expiry, interrupted browser return, a manual deposit before checkout, duplicate clicks, and uncertain provider responses.
5. Request partial and full sandbox refunds as owner. Verify real provider outcomes, pending/failed behavior, Stripe Dashboard refund imports, and staff/support rejection.
6. Confirm no customer document includes internal costs, provider credentials, or private ledger notes. Check public links and mobile/desktop navigation.

Remaining operational limits: a creation attempt whose outcome remains uncertain stays reserved; do not clear it based only on a local timeout. Reconcile with Stripe first. Payments already processing cannot be canceled through the unpaid-checkout control. Subscription billing for Shop Revenue itself is outside this invoice-payment implementation.

## Sandbox integration progress (2026-10-28)

- Shop Revenue sandbox is claimed, CLI-authorized, and enabled for Connect with direct merchant payments.
- One synthetic full-Dashboard test merchant was created through Accounts v2. Hosted onboarding was completed with synthetic identity details and Stripe’s supplied test bank, and submitted with explicit user approval. Card payments remain restricted while Stripe checks the test identity; the remaining requirements are awaiting action from Stripe, with no field errors returned.
- A restricted sandbox app key is configured for preview deployments. Actual SDK calls successfully retrieved the connected merchant and created a v2 hosted-onboarding link.
- The key permits Accounts v2 reads, merchant configuration writes, onboarding links and banner sessions, and connected-account Checkout/refund operations and PaymentIntent reads. No transfer or payout permissions were selected.
- Earlier sandbox keys exposed in the setup interface were expired. Active credentials are stored privately; no secret values belong in this repository.
- With explicit user approval, one sandbox Connect snapshot webhook was created for the eight listed events. Its signing secret is configured as a sensitive preview variable. The Vercel protection credential is shared only with this provider destination; the setup-screen token was replaced and revoked after the interface displayed it. Deployment Protection remains enabled.
- Hosted verification exposed a missing `DATABASE_URL_WORKER`. The existing preview `worker_user` credential was rotated and configured for the same TLS-encrypted Supavisor transaction connection used by the hosted setup script; its existing RLS and column grants remain unchanged. No production variables or databases were changed.
- The stable preview now serves tested commit `0ef7398132a6ed4230eecc78ff49d1d8bbb510cf` with these runtime settings. Health and database checks passed. An invalid webhook signature returned 400; a signed synthetic probe and its replay returned 200 and produced one ignored inbox row. This verifies the deployed signature and inbox path, not actual Stripe-originated delivery.
- Actual Stripe-originated `account.updated` snapshot events from the authorized synthetic merchant reached the durable inbox successfully during hosted onboarding. They were ignored before the shop connection existed. This establishes provider delivery but does not establish invoice settlement or refund correctness.
- The preview maintenance role could not append an audit record while linking the merchant; the transaction rolled back. `scripts/dev/link-m4-sandbox.ts` performs the link and audit together through the existing runtime worker role. Its CI workflow pulls only preview configuration, requires the exact development Supabase project, preview shop, sandbox merchant, and M4 branch, and refuses live mode or account reassignment.
- Real hosted Checkout, payment-event replay, and provider refunds remain unverified. Automated tests using synthetic provider objects are not a substitute for these checks. No production resources were changed.
