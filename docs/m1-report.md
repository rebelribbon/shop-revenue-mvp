# Milestone 1 report: Foundation and tenant isolation

> **Superseded for acceptance status by `docs/m1-audit-2026-10-24.md`.** That audit found and fixed a cross-tenant FK gap (migration 0008) and a PITR gate that could never pass. It records the production deploy pipeline as not yet run end to end and off-site backups as never run.

Spec: `docs/build-spec-v1.1.pdf` §26 M1. Branch `m1-foundation`. Status as of 2026-10-23.

Legend: **DONE** verified by the evidence named · **PARTIAL** built and verified locally, hosted part blocked · **BLOCKED** needs an account that does not exist yet (setup steps in the last section) · **NOT DONE** not built yet.

## Acceptance criteria (§26 M1)

| Criterion | Status | Evidence |
| --- | --- | --- |
| Two seeded tenants | DONE | `pnpm seed` (tenants A and B, owner + staff each, two admins, one support). Test runs seed their own tenants through the real domain functions. |
| Full RLS and cross-tenant suites green | DONE (M1 scope) | `tests/db/rls.test.ts`: generated from the catalog for every `business_id` table (74 tests) and fails if a tenant table has no fixture. Cross-tenant identity parts in `tests/server/actions.test.ts`. 123 Vitest tests green locally and in CI. Matrix rows about customers, estimates, invoices, files, inbound SMS and Stripe metadata need M2–M5 tables and are not applicable yet. |
| CI fails a migration that adds a tenant table without RLS | DONE | CI step "RLS check rejects a tenant table added without RLS" applies `tests/fixtures/migration-without-rls.sql` to a fresh chain and requires `scripts/db/check-rls.ts` to reject it; also asserted in `tests/db/rls.test.ts`. |
| Owner invites Staff | DONE | `tests/domain/m1-flows.test.ts`; Playwright F1 flow (admin creates shop → owner accepts → owner invites staff → staff accepts). |
| Staff blocked from Owner-only actions | DONE | Hidden in the UI (Playwright E2E #1b) and rejected server-side (`tests/server/actions.test.ts`, domain tests). |
| View-as is read-only and appears in the support access log | DONE | Read-only three ways: READ ONLY transaction, restrictive RLS policies for `actor_type = 'support'` (`tests/db/constraints.test.ts`), and the action wrapper (forbidden + audited, `tests/server/actions.test.ts`). Playwright: support starts view-as with a reason; the owner's S29 log shows who, reason, duration and start/end audit events. |
| Production deploy pipeline runs migrations | BLOCKED | `.github/workflows/deploy.yml` (CI → migrate staging → deploy → health → E2E → approval → PITR check → migrate production as `migration_owner` → deploy). Fails naming the missing configuration. |
| One backup restored successfully into a scratch project | PARTIAL | `scripts/backup/restore-drill.ts` restored **hosted dev → a scratch database on the local stack**: 18 tables / 973 rows identical, RLS intact, grants intact, 8 migrations; dump 11.1 s, restore + verify 1.2 s. No hosted restore-scratch project exists; the nightly off-site job (`backup.yml`) is BLOCKED. |

## M1 "Delivers" list

| Item | Status | Notes |
| --- | --- | --- |
| Repository, CI | DONE | GitHub Actions: `ci.yml` (Postgres 17 service container) and `e2e.yml` (Supabase CLI stack on the runner, production build, Playwright at 390x844 + desktop), both green on e9d3760. |
| Environments: local | DONE | Supabase CLI stack (Postgres, Auth, Storage, Mailpit). |
| Environments: hosted dev | PARTIAL | Roles bootstrapped, full chain applied (0000–0007; re-run is a no-op), RLS check passes (re-run 2026-10-23 after the password reset), interleaved test run through the transaction pooler. API keys present (Supabase publishable + secret keys, written to `.env.dev-hosted` by `scripts/dev/hosted-env.ts`): publishable key reads `/auth/v1/settings` (HTTP 200) and is refused by the admin API (401); secret key reaches the admin API (200). Running the app on it remains BLOCKED on Auth configuration (setup A.3–A.6): hosted Auth currently has **sign-ups open** (`disable_signup=false`) and the **phone provider off**, and no Send-SMS hook or SMTP. |
| Environments: preview, staging, production, restore-scratch | BLOCKED | Projects do not exist. |
| Schema (12 tables) | DONE | business, location, user, membership, internal_user, support_session, activity, audit_event, request_idempotency, webhook_event, legal_policy, file; migrations 0000–0007. |
| Roles and RLS | DONE | `migration_owner` owns everything; `app_user`/`worker_user`/`admin_user` own nothing, no BYPASSRLS (verified from `pg_roles` at bootstrap). Every `app` table has RLS enabled + forced. |
| `withTenant` | DONE | `src/db/tenant.ts`; ESLint forbids raw clients elsewhere in `src/`. |
| Sign-in | PARTIAL | Email magic link and SMS code (S30), httpOnly/SameSite=Lax cookies, verified server-side per request; sign-up closed. Hosted: keys present; BLOCKED on Auth configuration (sign-up still open, phone provider off, no Send-SMS hook, no SMTP). **MFA via SMS on a new device (S30/§27) is NOT DONE.** Phone MFA is enabled in the local Auth config only. |
| Invite and Staff slot | DONE | Owner + one Staff (partial unique indexes + two-member trigger); invite tokens 32 bytes, SHA-256 stored only, 7-day expiry, rotate on resend, revocable. |
| Admin sign-in | PARTIAL | Allowlisted `internal_user` + Google provider + domain check outside local; local-only email path (requires a local Auth host). Google Workspace SSO: BLOCKED. |
| Tenant list (I1), view-as | DONE | Includes create business (F1) with owner invite, owner-invite resend, staff reset on owner request. |
| Legal policy manager (I5) | DONE | Drafts, second-admin approval with memo reference, previous version retired atomically, approved text immutable (trigger), platform audit rows. |
| Generic webhook inbox with replay (I4) | DONE (local) | Stripe/Twilio/Postmark routes verify signatures, store first, enqueue in the same transaction; 8 attempts with 1 min → ~4 h backoff, then `dead` + alert log; admin replay audited; applied events never re-applied. Real provider deliveries: BLOCKED. |
| Sentry | BLOCKED | Wired for web and worker with PII stripped; off without `SENTRY_DSN`. |
| Logs | DONE | Structured JSON (pino) with request IDs and redaction; token path segments masked. |
| Health route | DONE | `/api/health`: DB, worker heartbeat (≤ 3 min) and queue lag; 503 when not OK. Verified locally with a live worker. |
| Off-site backup job | BLOCKED | `backup.yml`: pg_dump of app, graphile_worker, drizzle, auth and storage schemas plus storage sync, age-encrypted, uploaded via OIDC to S3 in the separate account. Dumping these schemas from hosted dev was verified. |

## M1 risks (§26)

- **RLS with pooled connections.** `tests/helpers/interleave.ts`: 1,000 requests at concurrency 40 across 3 tenants × 2 users. Each request checks its context, writes, and must see only its own rows; every 10th runs with no context on the same pool and must see nothing.
  - Local (10-connection pool): 0 violations.
  - **Hosted dev through the transaction pooler** `aws-0-us-east-1.pooler.supabase.com:6543`: 0 violations (44–45 s, run twice; the second run used rotated credentials and migrations 0000–0007).
  - The test can fail: switching `set_config` to session scope made it fail immediately with cross-tenant rows.
- **Supabase Auth to membership mapping.** `app.resolve_memberships(auth_subject)` (SECURITY DEFINER) is the only cross-tenant read; removed or deactivated access ends on the next request (Playwright: removed staff lands on `/no-access`).

## Spec issues

1. **audit_event is tenant-owned with `business_id NOT NULL` (§7), but platform admin actions must be audited (§10).** Resolved by making `business_id` nullable for platform rows only: `CHECK (business_id IS NOT NULL OR actor_type IN ('internal','system'))`. `app_user` sees and writes only `business_id = current tenant`; `worker_user`/`admin_user` see platform rows only outside a tenant context. Append-only by grants and a trigger that blocks UPDATE/DELETE/TRUNCATE even for the owner.
2. **support_session and webhook_event are "global" (§7) but carry `business_id`.** The CI rule is unchanged: both have RLS enabled + forced with role-specific policies. The shop reads only its own support sessions; worker/admin read across tenants; `app_user` has no grant or policy on `webhook_event` and ingests through `app.ingest_webhook_event` (SECURITY DEFINER).
3. **request_idempotency is tenant-owned, but platform admin actions (createBusiness, approveLegalPolicy, replay) have no business.** They use natural idempotency instead: status-guarded transitions, unique constraints, one approved policy per kind.
4. **Graphile Worker enables RLS with no policies on its private tables** and expects to connect as their owner. With the spec's non-owner `worker_user`, the worker would silently see an empty queue. The migrate runner grants `worker_user` explicit queue policies (caught by a test).
5. **membership has only `user_id, role, status` (§7), but invites need a contact, token hash and expiry, and no user exists until acceptance.** Added `invite_*` columns; `user_id` is null only while invited or after revoking an invite.
6. **S29 must show who accessed the account, but the shop can never read `internal_user`.** `support_session.admin_display_name` is snapshotted at start and immutable.
7. **The `heartbeat` job (§18) has no table.** It uses Graphile's own cron execution record, read through `app.worker_status()` (SECURITY DEFINER).
8. **activity.customer_id / asset_id** reference M2 tables; they are added with them.
9. **"Active business stored server-side on the session record" (§9)** has no session table among the 53. Multi-membership uses a signed cookie re-checked against live memberships on every request; one membership (the MVP norm) needs nothing.
10. **Supabase Auth configuration is subtler than the spec implies.** The CLI's `[auth.email]/[auth.sms] enable_signup` turn the providers on or off, not just sign-up. Sign-up closure must come from the global flag (verified: `signup_disabled` for unknown email and phone). The phone provider also needs an SMS provider configured even when the Send-SMS hook delivers every code.
11. **Phone MFA on hosted Supabase may be plan-gated.** The CLI config marks MFA as a paid-plan feature; confirm before building new-device MFA on hosted environments.

Bugs found and fixed by the suites: revoking an unaccepted invite violated a check constraint (0005); invalid `legal_policy`/`file` transitions surfaced as permission errors (0006); column-level INSERT grants are incompatible with Drizzle's full-column inserts (0004); passing functions from server to client components broke the Team page.

## Security notes

- **Credential exposure on 2026-10-23.** A shell command sourced `.env.dev-hosted`; unquoted `&` in URLs made bash echo the hosted dev `postgres` password and four role passwords into tool output. The four role passwords were rotated immediately and verified. **Resolved:** the hosted dev `postgres` password was reset in the Supabase dashboard and `SUPABASE_DEV_DB_PASSWORD` updated; verified 2026-10-23 that the old password is rejected (`28P01`) and the new one connects (session pooler), and that `migration_owner` and `app_user` connect through the transaction pooler (6543). Env files are now single-quoted and are only read through Node.
- **Next.js:** 16.4.0 had GHSA-2464-fhr4-w9xw and GHSA-673q-mjm6-r5xr (critical, unauthenticated RCE) and GHSA-p3m5-59mp-jv5r (high, DoS). Upgraded to 16.4.2; the Next packages are exempted from the 14-day release-age policy, with the reason recorded in `pnpm-workspace.yaml`. `pnpm audit --prod`: no known vulnerabilities.
- **Dev-only audit findings remaining:** esbuild (moderate, dev-server CORS; reached via drizzle-kit's deprecated loader, and esbuild serve is never run) and braces (high, ReDoS in an ESLint plugin dependency; no patched version).
- `cacheComponents` is off: nothing tenant-scoped is cached across requests.

## Not done in M1

- New-device SMS MFA for shop users (S30, §27).
- Alerts beyond log lines (§20 alerting is M9); the RLS production canary (M9).
- PostHog analytics (no M1 events).

## Setup steps for BLOCKED items

**A. Hosted dev, to run the app on it**
1. ~~Reset the `postgres` password~~ (done 2026-10-23; see Security notes).
2. ~~Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`~~ (done locally in `.env.dev-hosted` from `SUPABASE_DEV_ANON_KEY` / `SUPABASE_DEV_SERVICE_ROLE_KEY`; still to be set in Vercel/Render when they exist).
3. Auth → URL configuration: Site URL = app URL; redirect allowlist `https://<app>/auth/callback**`.
4. Auth → Providers: Email on, Phone on; **Allow new users to sign up: off**. (Observed 2026-10-23: sign-up is currently **on** and Phone is off.)
5. Auth → Hooks: Send SMS hook → `https://<app>/api/auth/hooks/send-sms`; generate its secret and set `SUPABASE_AUTH_HOOK_SECRET`.
6. Auth → SMTP: Postmark (sender domain with SPF/DKIM/DMARC) so magic links leave Supabase's rate-limited default mailer.
7. Keep the Data API disabled (already done).

**B. Staging, production, restore-scratch (us-east-1, paid tier; PITR 7 days on production)**
1. Create the projects with Data API disabled.
2. `pnpm exec tsx scripts/dev/hosted-env.ts .env.<env>` with the project ref and postgres password, then `ENV_FILE=.env.<env> pnpm db:bootstrap && pnpm db:migrate && pnpm db:check-rls`.
3. Move the role URLs into Vercel/Render and the GitHub environments; delete the local file.
4. Apply A.3–A.6 per project.
5. Restore drill into restore-scratch: `SOURCE_ENV=.env.production TARGET_ENV=.env.restore-scratch pnpm backup:restore-drill`.

**C. Google Workspace SSO for /admin**
1. Workspace: OAuth client (Internal), with the redirect URI from Supabase's Google provider page.
2. Supabase: enable the Google provider with that client.
3. Set `ADMIN_ALLOWED_EMAIL_DOMAIN`.
4. Enforce MFA in Workspace.
5. Insert `internal_user` rows (allowlist).
6. Because sign-up is closed, pre-create each admin's auth user, or add a `before_user_created` hook allowing only Google identities on the domain.

**D. Vercel and Render**
1. Vercel project in region `iad1`; app env vars per `.env.example`; short-link domain.
2. Render background worker running `pnpm worker`. Set `DATABASE_URL_WORKER_SESSION` to the **session** pooler (5432; LISTEN/NOTIFY) and `DATABASE_URL_WORKER` to the transaction pooler.
3. Put the deploy hook URL in the GitHub environment.

**E. GitHub environments**
1. Create `staging` and `production` (with required reviewers) holding the secrets and vars named in `deploy.yml` and `backup.yml`.
2. Add `SUPABASE_ACCESS_TOKEN` for the PITR check.

**F. Off-site backups (separate AWS account)**
1. S3 bucket with SSE-KMS, versioning and a 35-day lifecycle expiry.
2. IAM role trusting GitHub OIDC for this repo, allowed `s3:PutObject` on the bucket.
3. An `age` keypair: the private key is kept offline; set `BACKUP_AGE_RECIPIENT`.
4. Supabase Storage S3 access keys; set `BACKUP_DATABASE_URL` to the session pooler as a role with BYPASSRLS (Supabase `postgres`).

**G. Sentry:** web and worker projects; set `SENTRY_DSN` and `SENTRY_ENVIRONMENT`.

**H. Uptime:** Better Stack check on `/api/health` (it returns 503 when the DB or worker is unhealthy).

**I. Providers for the webhook inbox:** `STRIPE_WEBHOOK_SECRET`, `TWILIO_AUTH_TOKEN` (primary account), `POSTMARK_WEBHOOK_USERNAME`/`PASSWORD`. Until set, each route answers 503 rather than accepting unsigned events.
