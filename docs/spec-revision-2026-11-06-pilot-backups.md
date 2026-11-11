# Pilot backups using the existing Supabase plan

Date: 2026-11-06

Decision: the product owner explicitly declined purchasing AWS backup services
for the pilot. The pilot uses the existing Supabase daily database backups.
This revision supersedes the off-site requirement for the closed pilot only.

The later [pilot activation decision](spec-revision-2026-11-06-pilot-activation.md)
supersedes this document's five remaining pre-deployment evidence requirements:
they are reported honestly as pending while the owner-authorized closed pilot
deploys for real production verification. Commercial release requirements remain.

## Pilot release

- Select `release_profile: pilot` in the protected-main Deploy workflow.
  `commercial` remains the default; unknown profiles fail verification.
- Public signup must remain explicitly disabled. Pilot shops are admitted
  through controlled invitations; this profile does not enable general signup.
- CI must still pass migrations, RLS, production-role tests, the application
  schema restore/isolation drill and browser/MFA checks on the exact candidate.
- Before the production build or migrations, the workflow must verify an actual
  completed Supabase daily backup no older than 26 hours, or an already enabled
  PITR restore point no older than 24 hours. Future timestamps and failed reads
  cannot satisfy that check. This step only reads provider configuration.
- The pilot defers only `offsiteBackupRestore` and the commercial
  `productionRecovery` evidence. Independent security review, production auth/MFA,
  delivered email, alert/on-call verification and design-partner evidence remain
  required at the exact release commit. No proof is generated for unfinished work.
- No AWS account, bucket, paid PITR upgrade or replacement backup subscription
  is purchased or provisioned by this revision. The existing AWS workflow is
  retained for a future broader launch; it has no configured destination.

## Coverage and limits

Supabase Pro includes the last seven days of daily database backups. Its
database backups contain Storage metadata, not uploaded file objects. Provider
backups also disappear if the Supabase project is deleted. Daily recovery can
lose roughly a day's changes; the gate allows up to 26 hours between backups.

Pilot operators must retain original uploads and downloaded signed PDFs and
receipts. The CI application-schema restore is not proof of a full Supabase
Auth/Storage recovery or an independently stored copy. After a provider restore,
custom database-role passwords must be reset and runtime credentials updated.

Provider reference: https://supabase.com/docs/guides/platform/backups

## Broader launch

Selecting `commercial` retains all seven release-evidence requirements,
including the independently stored backup/restore proof and the existing
daily-offsite or PITR recovery checks. Expanding from the closed pilot requires
finishing those requirements. This revision does not approve legal wording,
change tenant isolation or remove any authentication requirements.
