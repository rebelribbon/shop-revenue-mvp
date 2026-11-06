# Commercial recovery without the PITR add-on — November 5, 2026

Brad declined the approximately $100/month Supabase PITR add-on and approved
continuing with the lean launch setup after the daily-recovery tradeoff was
explained. This replaces the mandatory paid-PITR condition in the October 24
restore-point revision. It does not waive independent off-site backups or the
restore and security-review launch gates. PITR remains disabled; this revision
does not purchase any service.

## Daily recovery path

Commercial release may use Supabase daily backups together with the existing
encrypted, independent-account nightly off-site backup design. At release,
both completed backups must be no older than **24 hours**, with no future or
invalid timestamps. The existing provider migration guard additionally checks
the real Supabase backup API; its 26-hour daily-backup allowance is not the
commercial release freshness requirement.

Daily recovery can lose approximately one day's changes. This is an operating
recovery target, not a promise of continuous recovery or zero data loss. Restore
time must be measured in the real drill before onboarding; no recovery-time SLA
is asserted by the code.

All these conditions remain required before real customer data enters production:

- Unattended nightly backup execution from reviewed protected-main code, with
  least-privilege credentials. Use an appropriate protected backup environment;
  do not remove the production deployment approval rule to unblock a schedule.
- Client-side `age` encryption, private independent-account object storage,
  offline custody of the decryption key, the existing 35-day retention target,
  and provider encryption/access controls. New storage/encryption costs must be
  quoted before provisioning paid resources.
- Application, queue and migration schemas, Supabase Auth and Storage metadata,
  and private Storage objects are covered. Provider database backups alone do
  not back up the actual stored files.
- A successful off-site download, decrypt and full restore drill; verify row
  counts, role/grant/RLS isolation and restored private files. The ordinary CI
  application-schema restore cannot stand in for this evidence.
- Failure/staleness alerts with a named operator and a demonstrated alert drill.
  A configured schedule without a successful real run is insufficient.
- The independent candidate security review and all other commercial evidence.

## Release evidence

Replace the old `pitr` evidence entry with `productionRecovery`. It retains the
same exact candidate `commit`, recent `verifiedAt` and real report `reference`
required of every release entry. For daily recovery, also provide:

```json
{
  "mode": "daily-offsite",
  "providerBackupAt": "<actual completed Supabase backup timestamp>",
  "offsiteBackupAt": "<actual completed independent backup timestamp>"
}
```

These fields must come from the provider/job results referenced by the report.
Do not invent timestamps or references. `offsiteBackupRestore` remains a separate
mandatory evidence entry for the actual full recovery drill. Public enrollment
stays disabled until the complete release checks pass.

An optional future PITR deployment uses `mode: "pitr"`, verified integer
`retentionDays` of at least 7 and `latestRestorePointAt` no older than 24 hours.
It still needs independent off-site restore evidence. Selecting this mode in a
report does not activate or pay for PITR.
