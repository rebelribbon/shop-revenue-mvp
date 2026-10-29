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
- One synthetic full-Dashboard test merchant was created through Accounts v2. Hosted onboarding was completed with synthetic identity details and Stripe’s supplied test bank, and submitted with explicit user approval. Stripe subsequently reported card payments `active` with an empty requirements list. The merchant is linked only to Preview Shop LLC in the development project, with `livemode=false` and one setup audit record.
- A restricted sandbox app key is configured for preview deployments. Actual SDK calls successfully retrieved the connected merchant and created a v2 hosted-onboarding link.
- The key permits Accounts v2 reads, merchant configuration writes, onboarding links and banner sessions, and connected-account Checkout/refund operations and PaymentIntent reads. No transfer or payout permissions were selected.
- Earlier sandbox keys exposed in the setup interface were expired. Active credentials are stored privately; no secret values belong in this repository.
- With explicit user approval, one sandbox Connect snapshot webhook was created for the eight listed events. Its signing secret is configured as a sensitive preview variable. The Vercel protection credential is shared only with this provider destination; the setup-screen token was replaced and revoked after the interface displayed it. Deployment Protection remains enabled.
- Hosted verification exposed a missing `DATABASE_URL_WORKER`. The existing preview `worker_user` credential was rotated and configured for the same TLS-encrypted Supavisor transaction connection used by the hosted setup script; its existing RLS and column grants remain unchanged. No production variables or databases were changed.
- Initial hosted configuration verification used tested commit `0ef7398132a6ed4230eecc78ff49d1d8bbb510cf`; later fixture operations use the same deployed payment code. Health and database checks passed. An invalid webhook signature returned 400; a signed synthetic probe and its replay returned 200 and produced one ignored inbox row. This verifies the deployed signature and inbox replay path; actual provider delivery was then observed during onboarding.
- Actual Stripe-originated `account.updated` snapshot events from the authorized synthetic merchant reached the durable inbox successfully during hosted onboarding. They were ignored before the shop connection existed. This establishes provider delivery but does not establish invoice settlement or refund correctness.
- The preview maintenance role could not append an audit record while linking the merchant; the transaction rolled back. `scripts/dev/link-m4-sandbox.ts` performs the link and audit together through the existing runtime worker role. Its CI workflow runs the helper inside a hosted Vercel preview build because sensitive environment values cannot be exported with `vercel pull`. The helper requires the exact development Supabase project, preview shop, sandbox merchant, and M4 branch, and refuses live mode or account reassignment.
- The audited runtime fixture link completed successfully. `prepare-m4-sandbox-invoice.ts` creates one labeled $100 synthetic invoice through application roles and a real estimate-authorization/invoice chain; its random public bearer remains outside source and logs (only its hash is committed). Re-running the helper reuses the same quote/invoice and does not create duplicate customers.
- The public invoice Pay button successfully created a real sandbox Checkout Session on the correct connected merchant. The invoice showed $100 due and no internal cost information. Checkout displayed Sandbox and $100, and the database reservation remained `open` with no payment ledger entry.
- Automatic approval review rejected final Checkout submission, including the attempted decline test, because it requires the user to perform that final payment step. No payment was submitted by the agent. Stripe’s successful available-balance test card was prepared with Link saving disabled for the user’s final click.
- The first unpaid Checkout expired without a charge. A fresh Checkout was created through the public invoice and completed by the user. Stripe returned `complete`, `paid`, USD 10000 cents, and `livemode=false` for session `cs_test_a1i8miLyCOT1geNFfW9nK89LPtzTVO44SCkqUgINIOC2krbZaDe03C17wG` on the authorized merchant.
- Stripe-originated `checkout.session.completed` event `evt_1UVZgu2fKiM8lfFOKrJUztpj` is `applied`, with no processing error. Invoice #1001 has exactly one payment ledger entry, total and paid amounts of 10000 cents, and zero outstanding balance. Provider PaymentIntent: `pi_3UVZgq2fKiM8lfFO1z8wkjWr`.
- Payment-event replay was verified through the configured Stripe endpoint’s Event deliveries / Resend control. Stripe displayed Delivered, Recovered, and Resent manually. After replay, the durable inbox still contained one event and the invoice ledger still contained one 10000-cent payment. A Workbench shell resend command was unsupported; the actual replay used the Dashboard control.
- The user submitted the $25 partial refund in the correct connected merchant’s Dashboard. Stripe refund `re_3UVZgq2fKiM8lfFO1Ox7DwLw` is `succeeded`, USD 2500 cents. Real `refund.created` event `evt_3UVZgq2fKiM8lfFO1Fjc065w` is applied with no error; the ledger has exactly one -2500-cent refund entry alongside the original 10000-cent payment, leaving 7500 cents net paid and 2500 cents due. No agent submitted the refund.
- The user then submitted the remaining $75 refund. Stripe refund `re_3UVZgq2fKiM8lfFO1fC9S5Jv` is `succeeded`, USD 7500 cents. Real `refund.created` event `evt_3UVZgq2fKiM8lfFO1Bl9qAF4` is applied with no error. The ledger contains the original +10000 cents and exactly two refund entries (-2500 and -7500), totaling zero net paid. The original payment is fully refunded; the unchanged $100 invoice has $100 due again, not a zero balance.
- Provider-verified checks now include successful payment, signed settlement, provider event replay without duplicate posting, and Dashboard partial/remaining-balance refunds imported through real webhooks. Real decline handling, asynchronous/pending/failed provider outcomes, and the owner-initiated app refund flow still need provider verification separately from the Dashboard import. Automated tests using synthetic provider objects are not a substitute for these checks. M4 remains open; no production resources were changed.

## Preview account recovery follow-up (2026-10-28)

- Preview owner `info@rebelribbon.com` is active and confirmed, with a password configured; no ban or deletion was observed. The preview uses development Supabase, separate from production and Stripe credentials. Password values were never read or changed.
- Preview `APP_BASE_URL` still referenced an older M2 deployment. Updated only the preview variable to the stable M4 alias and rebuilt the already tested payment source (`9edece94ecdfb308d3af8d14d54c0c743c388d80`) with normal `pnpm build`. No fixture setup command ran.
- Replacement deployment `dpl_ECihSrNH6ReaEhgRgomzKvTF5Pzk` is READY; exact-deployment health/database, sign-in, and forgot-password checks passed. Stable M4 alias now points to it. Production is unchanged.
- The password-recovery form is reachable. No reset email was sent by the agent and no password was changed. Supabase Dashboard redirected to sign-in, so its redirect allowlist was not inspected or changed; emailed-link delivery/callback still require verification when the user requests recovery.

## Preview authentication repair (2026-10-28)

- Supabase edge logs showed HTTP 401 for both password sign-in and recovery, including recovery after the callback-origin correction. Reset requests were rejected upstream; the application incorrectly returned the neutral sent-email message for that service error.
- Replaced the preview public API-key value with the enabled publishable key from the exact development Supabase project. Changed only this public key variable to plain/config using upsert, so prebuilt preview builds receive its value rather than a sensitive-variable placeholder. Server-side secrets remain sensitive; production is unchanged. The original sensitive value could not be read, so its precise failure was not established.
- Code commit `8e3e9d526f23bb29d0d7c82e8d2a90cf3fb0b4ef` distinguishes provider/key, delivery, rate-limit and transport failures from bad credentials and successful reset requests. Provider status/code are logged without raw errors, passwords or tokens. Unknown-account responses remain generic.
- Lint, typecheck and three focused classification tests passed locally. Push and PR CI/E2E workflows completed successfully, including preview deployment. Stable alias resolves to `dpl_CBMNTMoBNFhRAHXrUqh5phpMcDJc` (`shop-revenue-jeha3772x-brads-projects-3548d304.vercel.app`).
- A secure sign-in attempt ended on a browser page-load error; a fresh protected app page showed the sign-in screen. No successful user session or delivered reset email has been verified. The agent has not submitted a new reset email request or changed the user's password. Custom SMTP status and Supabase redirect allowlist remain unverified.

- After the preview API-key repair, the user reported successful sign-in. Development Auth confirmed the preview owner's `last_sign_in_at` advanced to 2026-10-28T19:33:20Z. This verifies owner sign-in recovery; reset-email delivery remains a separate unverified check. The user's own-browser session is not shared with the agent browser.
- The previous deliberate-decline checkout expired unpaid. A fresh $100 sandbox Checkout was created through invoice #1001: `cs_test_a15sdUBudpH5nRG1X4xDvgvQ5EeBaNV85TBdoh3ZRkkIHybZSRLNMSkLYg`. It is prepared for user-performed decline, successful retry, and owner-initiated app refund verification; no final payment/refund was submitted by the agent.

## User-completed decline, retry and app refund verification (2026-10-28)

- The user supplied a Checkout screenshot showing the documented deliberate-decline test card ending 0002 rejected with “Your card was declined.” A subsequent customer-invoice screenshot showed $100 paid and zero due after retrying successfully. These establish the visible decline/retry outcome without retaining card details in source.
- The owner then initiated a $100 refund inside Shop Revenue. Durable request `7cae90e3-aebd-4584-907d-0f20fae09d88` records the actual preview owner as creator, the selected original payment, and status succeeded. Stripe refund `re_3UVeVp2fKiM8lfFO0GGZb1N9` independently reports succeeded, USD 10000 cents, PaymentIntent `pi_3UVeVp2fKiM8lfFO0oUegmDq`, and matching refund_request_id metadata.
- Actual `checkout.session.completed` event `evt_1UVeYz2fKiM8lfFOxkuhdhr6` and `refund.created` event `evt_3UVeVp2fKiM8lfFO07hWNGi2` are applied without errors. The second payment and its full refund each have one ledger entry. Across both trials, two +10000-cent payments and three refunds (-2500, -7500, -10000) total zero net paid. The unvoided $100 invoice is therefore due again.
- Core provider flows are verified: decline and successful retry, signed settlement, duplicate-event replay, Dashboard partial/full refund imports, and owner-initiated app refund with durable provider identity. Pending/failed/asynchronous provider outcomes and interrupted/uncertain-network edge cases remain covered by synthetic transport/database tests but have not all been reproduced against the real sandbox. Password-reset email delivery also remains unverified. These limits must remain visible in the M4 release assessment.

## M4 edge-case hardening pass (2026-10-28, America/Chicago)

- Fixed stale unpaid Checkout snapshots reopening a failed/expired reservation after a replacement attempt already existed. Terminal attempts now stay closed unless a verified paid provider response requires settlement.
- Fixed stale pending refund reads restoring failed/canceled reservations. Bound an existing refund request to its recorded Stripe refund ID, rejecting identity substitution rather than silently overwriting or ignoring it.
- Added real-Postgres regressions for failed/expired checkout replay with a replacement attempt, failed/canceled refund replay, and mismatched refund identity. Extended the uncertain-refund test through a successful retry with identical provider parameters/idempotency key, then a repeat request with exactly one negative ledger entry.
- Code commit `e817b5d94d128689cb2004f9e7fc83f801adfbb5`: lint/typecheck passed; all 275 database/domain/server tests passed (17 suites), including 15 payment tests. Desktop/phone browser coverage passed 19 tests with one desktop-inapplicable skip. CI runs 40793334613 and 40793340910 succeeded. Push E2E/deployment run 40793334671 completed the browser, migration/RLS, build and hosted smoke gates successfully.
- Deployment `dpl_uPBiQ8GbhRJ1jpcwMy8JRM8Bs13q` serves the tested code at `https://shop-revenue-251ksk3xy-brads-projects-3548d304.vercel.app`. Health reported the exact commit, database OK, and both sign-in/no-access pages passed. Stable M4 alias points to this deployment. No production resources or live financial state changed.
- The software edge-case pass is complete for these scenarios. Do not describe simulated asynchronous, pending/failed provider responses, or network faults as real Stripe sandbox observations. Advanced provider fault coverage and actual password-reset delivery remain explicit release-verification limits alongside the broader M9 launch gates.
