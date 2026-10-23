# M1 Hosted Status — 2026-10-23

This file supersedes stale hosted-environment statements in `docs/m1-report.md`. It does not replace the detailed implementation evidence in that report.

## Production web

- Vercel project: `shop-revenue-mvp`
- Canonical production URL: `https://shop-revenue-mvp.vercel.app`
- Production deployment at commit `05bbf4dc22280704d6f06ae44fc549ac19586c96` is READY.
- `/api/health` returns HTTP 200 with `status: ok` and a successful production database connection.
- The paid always-on Render worker is deferred for hosted M1 under `docs/spec-revision-2026-10-23-defer-always-on-worker.md`.

## Production database

- Supabase project: `shop-revenue-mvp-staging` (production target)
- Project ref: `akwxgjxdhfylebsteyqi`
- Region: `us-east-1`
- Status: ACTIVE_HEALTHY
- Migrations 0000–0007 applied.
- 12 app tables have RLS enabled and forced.
- Runtime roles remain non-superuser and without BYPASSRLS.
- Production `app_user` connectivity is verified from Vercel.
- Security advisor currently reports only seven Graphile Worker `function_search_path_mutable` warnings from upstream Graphile Worker functions; no new application-table security advisory was reported.

## CI / E2E

For commit `05bbf4dc22280704d6f06ae44fc549ac19586c96`:

- GitHub Actions CI run #28: SUCCESS.
- GitHub Actions E2E (local stack) run #19: SUCCESS.
- CI includes bootstrap, full migration chain, RLS checks, lint, typecheck, and real-Postgres test suites.
- E2E includes a production build and Playwright on phone and desktop viewports.

## Hosted environment model

The approved two-project revision remains in force:

- `shop-revenue-dev` = development and preproduction validation.
- `shop-revenue-mvp-staging` = production target despite its historical name.
- No third permanent Supabase project is required.
- Restore acceptance may use local or ephemeral scratch infrastructure.

## Production Vercel environment observed

Present for Production:

- `APP_ENV`
- `APP_BASE_URL`
- `SESSION_SIGNING_SECRET`
- `DATABASE_POOL_MAX`
- `SERVICE_NAME`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `DATABASE_URL_APP`

Not present in Production as of this status check:

- `SUPABASE_AUTH_HOOK_SECRET`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `POSTMARK_SERVER_TOKEN`
- `EMAIL_FROM_ADDRESS`
- custom SMTP variables

These missing values mean hosted email/SMS authentication delivery is not yet production-ready.

## Remaining M1 hosted work

1. Complete production Supabase Auth URL configuration and redirect allowlist.
2. Confirm public sign-up is disabled while required sign-in providers remain enabled.
3. Configure production email delivery (Postmark/custom SMTP or an approved equivalent).
4. Configure phone/SMS delivery only when the product milestone requires hosted SMS authentication; wire the Send SMS hook and its signing secret at that time.
5. Verify the actual hosted sign-in flow end to end after Auth configuration.
6. Complete GitHub staging/production deployment environment secrets required by `.github/workflows/deploy.yml` where the connector cannot manage repository secrets.
7. Complete off-site backup infrastructure or document an explicit M1 acceptance deferral.
8. Resolve or formally defer new-device SMS MFA before commercial release if required by the frozen specification.

## Current M1 assessment

Foundation, tenant isolation, hosted production database connectivity, production web deployment, health, CI, and local-stack E2E are working. The principal remaining hosted blocker is Auth/provider configuration plus off-site operational hardening, not application/database connectivity.
