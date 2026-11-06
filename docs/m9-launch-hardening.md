# M9 launch hardening

Status: implementation under verification; commercial release is blocked until the external evidence below exists. M5 texting and M6 imports remain out of scope. Shops contact customers themselves. Commercial subscriptions, trial and discount codes follow the November 5 revision in `spec-revision-2026-11-05-commercial-subscriptions.md`; activation requires the production release checks.

## Implemented

- Authenticator enrollment and verification for owners, staff, technicians and internal operators. Every hosted login requires MFA before shop/admin records, actions or direct downloads. No real user's factor is enrolled automatically.
- Atomic, hashed database throttles for sign-in, password reset, invitation setup and authenticator verification; password changes revoke other sessions.
- Same-origin redirects, sign-out origin checks, private page caching, security headers, public-link log masking and sanitized diagnostics.
- Owner-only streamed NDJSON exports for fifteen datasets, explicit tenant checks, audit trail, pagination and credential filtering. Exports contain customer information and costs and must be stored privately; they are not restore backups.
- Authenticated bounded maintenance endpoint; only revenue reconciliation jobs are executed by this endpoint. Worker advisory lock, tenant transactions, execution limits and durable successful heartbeat. Health distinguishes configuration from actual recent successful execution.
- Foreign-key indexes and fixed search paths for migration-owned queue functions. Provider-managed functions are not changed.
- Generic retry/error screens and loading states without customer data in diagnostics.
- Dependency audit, tracked-file credential patterns, pinned core CI actions, database restore/isolation evidence, release-commit checks and production configuration checks before migrations.

## Runtime and schedules

`GET /api/cron/maintenance` requires `Authorization: Bearer <CRON_SECRET>` with a separately generated secret of at least 32 characters. Never place it in a URL. An authenticated Vercel production cron is declared daily at 10:15 UTC. Vercel cron does not execute on preview deployments. A preview/provider schedule must be configured before setting `MAINTENANCE_SCHEDULE_ENABLED=true`; a healthy heartbeat additionally requires a real observed success. Configuration alone is not proof of execution; check the health maintenance heartbeat and scheduler response.

The bounded worker handles at most 25 completed/failed jobs per call, checks its 90-second budget between jobs, and applies a 15-second SQL timeout to reconciliation. Further due jobs await another run. Payment provider jobs remain on the dedicated worker path.

## Verification and release evidence

CI must pass the full migration chain, RLS checks, production-role tests, browser phone/desktop tests, audit and application-schema restore. The CI restore covers `app`, `graphile_worker` and `drizzle` into disposable PostgreSQL. It does not verify Supabase Auth, Storage or the off-site download/decrypt/restore chain.

Production deploy requires non-secret `release_evidence_json` supplied at dispatch, keyed by:
`independentSecurityReview`, `productionAuthAndMfa`, `smtpDelivery`, `offsiteBackupRestore`, `productionRecovery`, `alertsAndOnCall`, `designPartnerApproval`.
Each value is `{ "commit": "<exact SHA>", "verifiedAt": "<ISO timestamp>", "reference": "<review/report reference>" }`. Evidence must be recent (seven days); no secrets or customer records belong in these references. A prepared file outside the repository avoids a self-referential evidence SHA. Exact-build staging smoke is an automated prerequisite; production smoke runs automatically after deployment and is not a circular pre-deployment evidence requirement. Human review must actually be independent; generated implementation checks cannot substitute for it.

`productionRecovery` also requires the mode and verified restore-point timestamps
in [the November 5 daily-recovery revision](spec-revision-2026-11-05-daily-commercial-recovery.md).
The daily path requires both provider and independent backups no older than
24 hours. The separate full off-site restore evidence remains mandatory.

The preview provider scheduler uses a private `ops` function and synchronous `http`, with a bounded timeout and credentials read from Vault only in memory. Application and anonymous roles cannot call that function or read Vault. The asynchronous `pg_net` request queue was rejected for credentialed calls because provider-owned PUBLIC queue grants could not be revoked by the available postgres role. Its unused extension remains a provider cleanup item; no credentialed requests were queued.

## Outstanding external gates

- Configure transactional email and Supabase Auth SMTP; observe invite and password-reset delivery end to end. An accepted reset request is not delivered email.
- Configure server-side Supabase account administration, production worker/admin roles, internal Google sign-in/domain allowlist, and verify production owner MFA without locking out the owner.
- Configure monitoring destination and on-call ownership; run a staged alert drill and uptime checks for app/public/webhook paths.
- Configure independent-account off-site backup credentials, encryption, schedules and complete the off-site restore drill. Verify the chosen daily-offsite or PITR recovery path before real shop data. Repository workflows do not run on a non-default branch schedule.
- Complete independent security review of the exact candidate and record the candidate’s existing 20,000-customer CI benchmark (this is not a production latency guarantee).
- Configure production Stripe Connect separately from sandbox. Verify live webhook isolation and each shop's own connected account. Do not treat sandbox payment/refund tests as live settlement evidence.
- Confirm final commercial authorization language and design-partner onboarding/release evidence against the frozen release checklist. No legal review or provider purchase is initiated automatically.

No production application deployment has been made as part of this M9 work. Preview bootstrap environment credential values were cleared and the production public Supabase build key was corrected; these were configuration changes, not a production release.

## Verified preview

See [the dated verification report](m9-verification-2026-10-29.md) for the exact tested application commit, CI runs, hosted scheduler proof and remaining launch gates.
