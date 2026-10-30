# Final launch setup

The application code is complete through M9. Commercial activation is not approved by this document.

## Reviewed release candidate

[The consolidated release PR](https://github.com/rebelribbon/shop-revenue-mvp/pull/8) was merged into main at `8a0b27859723238166f1e060e14f8c1b9a2cf191` and includes M1, M2, M3, M4, M7, M8 and M9. Automated texting and imports remain out of scope. Production releases are manual and must run from protected main. Enable main branch protection/rulesets, require CI and browser checks, and configure a production environment reviewer and main-only deployment rule before dispatching a production workflow.

Production now stages a build without assigning live domains, tests that exact deployment through protection, then promotes the tested build. The backup workflow explicitly names the configured KMS key on every upload.

## Configuration inspection

The Launch setup inspection workflow validates its script without credentials on PRs/pushes. Its provider inspection runs only by manual dispatch for an exact reviewed protected-main SHA, through the existing staging/production environment approval rules. It reads Supabase Auth and backup metadata using the existing environment management token; it does not change provider settings or send email. Reports contain selected booleans, timestamps and HTTP status codes, never SMTP passwords, OAuth secrets, API keys or raw provider responses.

The inspection always reports launchReady=false. It is evidence about configuration, not delivery, recovery, monitoring or independent-review approval. If the token lacks auth_config_read/backups_read, the report records denied access without printing the response body. Do not broaden token permissions automatically.

See the official [Auth configuration API](https://supabase.com/docs/reference/api/v1-get-auth-service-config). Production Supabase is akwxgjxdhfylebsteyqi despite its historical staging name; preview is gcclcuvdrqqllolxqhok.

## Account setup still required

| Area | Concrete requirement | Verification |
| --- | --- | --- |
| Email | Resend sending-only production key scoped to shoprevenue.app; EMAIL_FROM_ADDRESS=no-reply@shoprevenue.app; EMAIL_PROVIDER=resend; separate production Supabase Auth SMTP | Production delivered invite/reset and completed account setup |
| Production auth | Server-only Supabase admin credential, worker/admin DB roles, internal Google provider/domain allowlist, TOTP and compromised-password protection settings | Owner/admin MFA, reset/session revocation and recovery on candidate |
| Payments | Live Stripe platform access and live server/webhook configuration, kept separate from sandbox | Connect onboarding per shop, authenticated webhook isolation and live-environment checks |
| Monitoring | Actual error-monitoring project/destination and named on-call ownership | Staged alert received/acknowledged and recovery observed |
| Backups | Separate-account encrypted bucket, KMS key, least-privilege OIDC role, private age identity and Storage S3 access | Scheduled off-site backup plus download/decrypt/restore, including Auth/Storage recovery |
| Database durability | Approved PITR retention before real-shop data | Provider backup metadata and recovery evidence |
| Security | Independent candidate review; separate scan when Codex Security is installed and connected | Findings resolved or explicitly assessed by independent reviewer |

Do not paste keys or passwords into chat or commit them. Enter credentials directly into the appropriate provider/environment settings. The connected Stripe session currently exposes a sandbox account only; that is not live-payment permission or a live API key.

## Backup configuration names

Production environment secrets: BACKUP_DATABASE_URL, BACKUP_AGE_IDENTITY (private decrypt identity), STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY.

Production environment variables: BACKUP_S3_BUCKET, BACKUP_AWS_REGION, BACKUP_AWS_ROLE_ARN, BACKUP_KMS_KEY_ARN, BACKUP_AGE_RECIPIENT (public encryption recipient), STORAGE_S3_ENDPOINT.

The off-site role needs permission to generate data keys/encrypt with the intended KMS key, write the intended bucket/prefix and list the prefix. A separate restore role needs read/decrypt. Never grant production application code the off-site delete/decrypt identity. Configure retention and run the actual recovery drill; CI application-schema restoration is a separate check.

## Configuration status — October 29, 2026

- Preview runs release candidate e82738af0a417c1bf016ddd11771ddf69283c88a. CI and browser checks passed.
- shoprevenue.app is verified in Resend. Preview sender is no-reply@shoprevenue.app with a Preview-only secret. Brad confirmed password-reset completion after correcting preview Auth URL settings. This is preview evidence, not production verification.
- shoprevenue.app redirects to www.shoprevenue.app; both are verified on the Vercel project. Production APP_BASE_URL is https://www.shoprevenue.app. EMAIL_PROVIDER and EMAIL_FROM_ADDRESS are prepared for production, but its separate Resend key is still absent.
- Sentry configuration exists in Preview and Production. Actual error ingestion, alert receipt and on-call recovery remain unverified.
- Temporary owner bootstrap environment values in Preview were cleared. Existing deployments retain their original environment until rebuilt.
- Production still serves the historical foundation build (49b625acab865f935331387409d983df0ca5ef1d); the M9 candidate has not been released there.
- main is unprotected. Production release requires protected main, the production environment reviewer and main-only deployment rule. Do not remove these guards to deploy.
- Production worker/admin database URLs, server-side Auth administration credential, maintenance schedule, production email key, live Stripe settings and internal admin domain remain absent from the Vercel configuration inspected.
- Production Auth SMTP, redirect URLs, MFA, compromised-password protection, backup retention and recovery evidence still need verification. Preview settings do not configure production.
- Off-site recovery, independent security review, alert drill and design-partner approval must be real evidence for the exact candidate. Do not manufacture release evidence.
- Customer-owned email-domain verification and onboarding are not implemented. Platform login/reset mail uses the Shop Revenue domain. Automated texting and imports remain excluded.
