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
| Email | Postmark account/server and verified sender; server token and EMAIL_FROM in Vercel; EMAIL_PROVIDER=postmark; matching custom Supabase Auth SMTP | Delivered invite/reset and completed account setup |
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

## Current confirmed limits

- Main was unprotected when inspected; the new release/inspection guards will refuse production actions until this is corrected.
- Vercel production does not yet have the required email, monitoring, worker/admin or live-payment configuration.
- No external service account was created or paid add-on enabled by this preparation.
- The workspace reconnected. Local lint/type checking and all six setup-inspector boundary tests passed. The merged application passed the 360 server/database tests and 27 browser checks, with one desktop-only skip. Superseded milestone PRs are closed; their commits are included in main.
- Stripe CLI and its Projects plugin are installed. Current catalog searches found neither Postmark nor Sentry, so no substitute provider was selected or account created. Vercel service discovery is waiting on account authorization. The provider configuration inspection itself has not run; its credential-free validation is separate.
- Unused preview pg_net cleanup and provider compromised-password protection remain in the dated M9 report.
