# Spec Revision — Production Restore Point Without PITR (Design-Partner Stage)

Date: 2026-10-24
Status: **Approved by the product owner (in session, 2026-10-24).**
Applies to: §24 production migration gate and §25 "PITR 7 days" on the production project, until commercial launch.

## Decision

Point-in-Time Recovery is a paid add-on and is not enabled on the production project (`shop-revenue-mvp-staging`, ref `akwxgjxdhfylebsteyqi`). This was confirmed on 2026-10-24: the Management API returned `pitr_enabled=false`.

Until commercial launch, the production migration gate accepts either of these:

1. a PITR restore point no older than 24 hours, if PITR is enabled; or
2. a `COMPLETED` Supabase daily backup no older than 26 hours.

Either one is read from `GET /v1/projects/{ref}/database/backups`. The gate still fails closed when neither exists.

## Why

Production holds no shop or customer data yet. A daily backup taken before a forward-only migration gives an acceptable recovery point at this stage. PITR costs money every month and adds nothing until real data exists.

## Conditions

- PITR (7 days) must be enabled before the first design-partner shop's real data enters production. This sits on the same launch checklist as the off-site backup revision.
- The production project must be on a plan with daily backups. If it is not, the gate blocks production migrations, which is the intended behaviour.

## Unchanged

Migrations still run as `migration_owner` with lock and statement timeouts. RLS checks still run after migrating. Restore drills, tenant isolation and every other §24 control are unchanged.
