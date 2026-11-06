# Commercial setup status — November 5, 2026

The approved retail offer is $49.99 per shop per month, a 14-day card-required
trial and product-scoped discount codes. Paid advertising remains $0. Brad
declined the approximately $100/month PITR add-on and authorized continuing
with the lean setup. Neither PITR nor the Vercel Pro upgrade has been purchased.
The inspected forecast for existing Supabase projects was $36.87/month; Vercel
quoted $21.32/month including estimated tax. Resend is on its free plan.
These are estimates, excluding further usage, payment fees and off-site storage.

## Verified provider setup

- Main is protected with required `test` and `e2e` checks. The production
  environment requires the owner review and accepts only main.
- Production Supabase custom SMTP is saved with Resend, the verified
  `shoprevenue.app` domain, `no-reply@shoprevenue.app` and port 465. A sensitive
  production `RESEND_API_KEY` exists in Vercel. Delivered production emails
  still need end-to-end verification.
- Production Auth has TOTP and leaked-password protection enabled, the canonical
  site URL and callback allowlist saved. New public signup remains disabled.
- The live $49.99 Price and customer portal exist. The subscription webhook is
  disabled until its deployed receiver is tested.
- Stripe account `acct_1UVIoCK3kUALRyLg` reports charges and payouts disabled,
  business details not submitted, and overdue verification requirements.
  Signing into Stripe does not activate payments. The owner must complete the
  business/representative details, payout setup and Stripe agreement directly.

## Initialize the two missing runtime logins

The `Initialize unused production database logins` workflow runs only on an
exact reviewed, protected-main commit and behind the existing production
environment review. Its explicit initialization input must be checked.
It uses the already-stored production `BACKUP_DATABASE_URL` and `VERCEL_TOKEN`.

It only initializes passwords for the existing `worker_user` and `admin_user`
when neither production URL is configured, neither role has active sessions,
and both roles have the expected safe attributes and no role memberships.
It changes no grants, RLS, app/migration credentials or schema. Generated
passwords go directly to sensitive production Vercel variables. Both role
logins are verified after committing. No passwords, SQL or connection strings
are returned in reports or artifacts. An existing pair is left alone; a
partial setup requires review. Failed writes roll back the database and remove
only variables marked with that run's unique operation identifier. An unknown
COMMIT outcome preserves saved credentials and requires manual review.

This workflow has not yet been run. It does not deploy the app, enable public
signup, provision Supabase service credentials, or create a Stripe API key.
The runtime still needs server-side Supabase account administration, internal
Google SSO/domain allowlist, the restricted live Stripe key (including account
read for activation checks), and the separate Connect signing configuration.

## Recovery and release remain blocked

Supabase daily backups exist and PITR remains off. The current commercial
release policy still requires PITR and independent off-site recovery evidence.
The cheaper daily-backup alternative needs a dated policy revision, encrypted
independent storage, unattended nightly execution, failure alerts and a real
download/decrypt/restore drill covering Auth and private Storage as well as
application data. No alternative recovery evidence has been asserted.

Finish those items, independent candidate security review, real production
email/MFA and alert drills, staging migration/smoke and owner onboarding
approval before using the gated production release workflow. Verify applicable
subscription tax registrations and a test calculation before enabling automatic
tax. Enable Supabase signup and `PUBLIC_SIGNUP_ENABLED` only after the release
and billing checks pass. Nothing in this report certifies legal compliance or
means public subscriptions are accepting payments today.
