# Spec Revision — Off-site Backup Timing for M1

Date: 2026-10-24
Status: **Approved by the product owner (in session, 2026-10-24).**

## Current state (facts)

- `.github/workflows/backup.yml` implements the Section 25 design:
  - nightly `pg_dump` of app, graphile_worker, drizzle, auth and storage;
  - storage bucket sync;
  - `age` encryption to an offline key;
  - upload over GitHub OIDC to an S3 bucket in a separate AWS account with SSE-KMS and a 35-day lifecycle.
- The job has **never run**. Scheduled workflows run only from the default branch, and the file exists only on `m1-foundation`.
- None of these are configured:
  - the separate AWS account;
  - the bucket, KMS key and lifecycle rule;
  - the OIDC role;
  - the `age` keypair;
  - Supabase Storage S3 keys;
  - the `BACKUP_*` secrets and variables.
- The production project has no shop or customer data yet.
- Supabase daily backups and PITR are the first line of defense. Whether PITR is enabled on the production project will be proven by the Deploy workflow's PITR gate.

## Decision

Move "off-site backup job running" from **M1 acceptance** to the **pre-launch gate before the first design-partner shop's real data enters production** (the Section 27 launch checklist, "off-site nightly backup running").

M1 keeps these:

1. The job definition in the repository, reviewed.
2. One successful restore drill into isolated disposable Postgres, already required by the two-project revision.
3. PITR verified by the production deploy gate.

## Conditions (all required)

- No real shop or customer data is written to production before:
  - the off-site job has completed one green run;
  - one off-site artifact has been downloaded, decrypted with the offline key and restored with `scripts/backup/restore-drill.ts`.
- This item stays visible as a launch blocker in the M1 audit file until both are done.

## What does not change

Tenant isolation, PITR requirements, encryption design, retention target, restore-drill requirement and the production deploy gate are all unchanged.

## Approval

Approved by: product owner, in the Claude session, 2026-10-24.
