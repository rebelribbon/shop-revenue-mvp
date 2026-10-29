# M9 preview verification — 2026-10-29

M9 implementation is usable in preview. This is not commercial-launch approval.

## Exact tested application

- Application commit: `18adfa810188123d85ebfd42274562638a7db002`.
- [Database/server CI](https://github.com/rebelribbon/shop-revenue-mvp/actions/runs/40931349038): 360 tests across 22 suites passed, full migration chain and RLS checks passed, tracked-file credential scan passed, production dependency audit reported no known vulnerabilities.
- [Browser and preview deployment](https://github.com/rebelribbon/shop-revenue-mvp/actions/runs/40931349096): 27 passed; one mobile-navigation check is deliberately skipped on desktop. Includes actual local-stack TOTP enrollment/code verification and QR image loading, owner exports, staff/anonymous denial, invitations, costing, customer/vehicle flows, Money Finder and attribution.
- Disposable application-schema restore passed in 1,928 ms, checking counts, journal, RLS, grants and isolation. This is not an Auth/Storage or off-site download/decrypt/restore drill.
- The warmed 20,000-customer Money Finder fixture measured median 12.1 ms, maximum 12.2 ms over five queries. This is a CI fixture result, not a production latency guarantee.
- [Exact preview deployment](https://shop-revenue-7j6z4z957-brads-projects-3548d304.vercel.app), also available through the [stable preview](https://shop-revenue-m4-preview-brads-projects-3548d304.vercel.app).
- Hosted smoke verified database health, exact application SHA, sign-in and no-access pages with Deployment Protection enabled.

## Hosted maintenance

The private provider function calls the authenticated Vercel endpoint using credentials read from Vault in memory. Application and anonymous roles cannot execute that function or read Vault.

An unsupported provider HTTP runtime option was removed from the operations script and applied/verified directly; this does not change application code. Two real provider cron runs succeeded at 18:38 and 18:39 UTC. The normal schedule is now `17 * * * *` (hourly, UTC). Health subsequently reported `mode: scheduled`, `healthy: true`, last success `2026-10-29T18:39:00.103Z`, and the exact tested application SHA.

The hosted queue had no due revenue work, so these runs verified authenticated scheduling and heartbeat with zero completed jobs. Execution of due revenue jobs through worker privileges is verified in CI. No queue permissions were broadened for testing.

## Remaining provider advisories

The hosted M9 migration cleared all seven Graphile mutable-search-path warnings and all 33 missing foreign-key-index notices.

Two security warnings remain:

- [Unused extension in public](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public): the newly enabled `pg_net` extension remains installed but unused and needs provider cleanup. Its provider-owned request queue grants PUBLIC access; attempted revocations did not change those grants. No credentialed requests were queued. The scheduler uses synchronous `http` and a private function instead.
- [Leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection): requires provider Auth configuration.

Informational performance notices include unused indexes on this lightly used preview and the provider Auth database connection limit mode. Indexes were retained; low preview usage is not evidence that a foreign-key or launch-scale index should be removed.

## Commercial launch still blocked

- Delivered production invite/reset email, Supabase Auth SMTP, and server-side account administration.
- Production worker/admin credentials, internal Google sign-in/domain settings, owner/admin MFA and recovery verification. No real user's authenticator was enrolled automatically.
- Production Stripe Connect configuration and real-environment verification, with each shop connecting its own account. Sandbox payment evidence is separate.
- Monitoring destination, named on-call ownership, staged alert/uptime drills.
- Required PITR retention before real-shop data; separate-account off-site encrypted backup and actual off-site recovery drill. Non-default-branch workflow schedules are not active backup protection.
- Independent security review of the candidate and design-partner acceptance, plus the remaining frozen commercial-release checklist.

The production application was not deployed. Earlier configuration changes cleared unused preview bootstrap credential values and corrected the production public Supabase build key. No real email, charge, refund, or payout was initiated during M9.
