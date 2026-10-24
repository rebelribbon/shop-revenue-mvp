# M1 Hosted Status — 2026-10-23

This file supersedes stale hosted-environment statements in `docs/m1-report.md`. It does not replace the detailed implementation evidence in that report.

## Production web

- Vercel project: `shop-revenue-mvp`
- Canonical production URL: `https://shop-revenue-mvp.vercel.app`
- Production deployment at commit `05bbf4dc22280704d6f06ae44fc549ac19586c96` is READY.
- `/api/health` returns HTTP 200 with `status: ok` and a successful production database connection.
- The paid always-on Render worker is deferred for hosted M1 under `docs/spec-revision-2026-10-23-defer-always-on-worker.md`.

## Preview / preproduction web

- Stable branch URL: `https://shop-revenue-mvp-git-m1-foundation-brads-projects-3548d304.vercel.app`.
- Preview deployment at commit `d0f4036033f874c76f57fc3bef601eb0a78a4824` is READY.
- `/api/health` returns HTTP 200 with `status: ok`, successful `shop-revenue-dev` database connectivity, and a 46 ms database latency on the verified request.
- Preview reports `backgroundProcessing.mode: deferred` and `requiredForM1: false`, matching the worker-runtime deferral revision.
- Preview `DATABASE_URL_APP` is now configured in Vercel and authenticated successfully through the Supabase shared transaction pooler.
- The temporary dev `app_user` credential used to establish hosted Preview connectivity must be rotated after M1 infrastructure setup, with the matching Vercel Preview secret updated at the same time.

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

For branch commit `d0f4036033f874c76f57fc3bef601eb0a78a4824`:

- GitHub Actions CI run #34: SUCCESS.
- The corresponding E2E run completed seven of eight tests successfully on its first attempt; the phone viewport timed out waiting for the Staff-invite success status even though server logs recorded `invite.delivered` and the same complete flow passed on desktop.
- That E2E job was re-run to distinguish a transient phone/UI timing failure from a reproducible defect. The rerun result must be green before final M1 acceptance.
- CI includes bootstrap, full migration chain, RLS checks, lint, typecheck, and real-Postgres test suites.
- E2E includes a production build and Playwright on phone and desktop viewports.

## Deployment pipeline

- `.github/workflows/deploy.yml` was revised at commit `d0f4036033f874c76f57fc3bef601eb0a78a4824` to remove the paid Render worker deployment requirement in accordance with the formal worker-runtime deferral.
- The workflow still enforces CI before staging, staging migration/RLS validation, Vercel staging deployment, staging health/E2E, production environment approval, PITR verification, production migration, Vercel production deployment, and production health.
- GitHub environment secrets and variables remain the last blocker to exercising this deployment workflow end to end. The connected GitHub integration cannot read or write Actions environment secrets.

## Hosted environment model

The approved two-project revision remains in force:

- `shop-revenue-dev` = development and preproduction validation.
- `shop-revenue-mvp-staging` = production target despite its historical name.
- No third permanent Supabase project is required.
- Restore acceptance may use local or ephemeral scratch infrastructure.

## Production Auth smoke test

- Site URL configured as `https://shop-revenue-mvp.vercel.app`.
- Redirect URL configured as `https://shop-revenue-mvp.vercel.app/auth/callback`.
- Public user signup disabled.
- Email provider enabled.
- Phone provider remains disabled for now.
- Built-in Supabase email delivery successfully delivered a production magic-link sign-in email.
- Production callback created a valid authenticated session.
- The authenticated test identity had no shop membership, and the app correctly redirected to `No shop access` rather than granting access.
- Vercel reported no runtime errors for `/sign-in`, `/auth/callback`, or `/no-access` during the hosted test window.

This verifies hosted email authentication, callback handling, session creation, and membership-denial behavior end to end. Custom SMTP is still required before commercial production use because Supabase's built-in mailer is rate-limited and not intended as the final production sender.

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

## Remaining M1 hosted work

1. Complete GitHub staging/production deployment environment secrets and variables required by `.github/workflows/deploy.yml`, then exercise the hosted migration/deploy pipeline end to end.
2. Require a green E2E rerun for the current branch commit, or fix the phone-only timing failure if it reproduces.
3. Complete off-site backup infrastructure or document an explicit M1 acceptance deferral.
4. Configure production custom SMTP before commercial use.
5. Configure phone/SMS delivery only when the product milestone requires hosted SMS authentication; wire the Send SMS hook and its signing secret at that time.
6. Resolve or formally defer new-device SMS MFA before commercial release if required by the frozen specification.
7. Configure hosted admin Google Workspace SSO if required for hosted M1 acceptance rather than local/CI acceptance.
8. Rotate the temporary dev `app_user` credential after hosted M1 setup and update Vercel Preview atomically.

## Current M1 assessment

Foundation, tenant isolation, hosted production and Preview database connectivity, production and Preview web deployment, health, CI, and hosted email sign-in/session enforcement are working. Final M1 acceptance remains blocked by the hosted GitHub migration/deploy pipeline configuration, the current E2E rerun result, and the remaining operational-hardening decisions listed above.
