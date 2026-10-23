# Build Spec v1.1 Revision Note — Two-Project Supabase Environment Model

Date: 2026-10-23
Status: Approved product-owner revision
Applies to: Milestone 1 environment, deploy, and restore acceptance only

## Decision

The hosted Supabase topology is reduced from separate dev, staging, production, and restore-scratch projects to two persistent hosted projects.

| Logical environment | Supabase project | Project ref | Purpose |
| --- | --- | --- | --- |
| Development / preproduction validation | `shop-revenue-dev` | `gcclcuvdrqqllolxqhok` | Hosted development, deployment validation, preview/staging E2E, pooled-RLS testing |
| Production | `shop-revenue-mvp-staging` | `akwxgjxdhfylebsteyqi` | Production database target for the commercial application |

The existing second project keeps its Supabase project name for now to avoid destructive recreation or extra cost. In architecture and deployment documentation it is the production project.

No additional persistent Supabase project is required for staging or restore-scratch.

## Deployment interpretation

The existing GitHub deployment stages remain logically named `staging` and `production`, but they map to the two hosted projects above:

1. CI runs first.
2. The `staging` GitHub environment uses `shop-revenue-dev` for hosted preproduction validation, preview deployment, health checks, and E2E.
3. Production remains approval-gated.
4. The `production` GitHub environment uses `shop-revenue-mvp-staging` as the production database.
5. Production migrations still run as `migration_owner` and retain the existing production safety checks.

This preserves the staged deployment gate without requiring a third always-on database.

## Restore-drill interpretation

The M1 acceptance criterion requiring one backup restore into a scratch project is revised to require one successful restore into an isolated disposable scratch Postgres environment.

The scratch environment may be local or ephemeral CI infrastructure and must:

- be isolated from both hosted projects;
- restore the production-format backup;
- verify table and row counts;
- verify migration ledgers;
- verify RLS remains enabled/forced where required;
- verify grants/ownership needed by the runtime roles;
- be destroyed after verification.

A permanently hosted `restore-scratch` Supabase project is explicitly not required.

The existing `scripts/backup/restore-drill.ts` local scratch workflow is the intended M1 implementation.

## Cost and scope rationale

The product is pre-launch and does not need four continuously billed Postgres instances. Two hosted projects preserve separation between development/preproduction and production while keeping infrastructure cost proportional to the current stage of the business.

This revision does not change tenant isolation, RLS requirements, database roles, migrations, backup format, application behavior, data retention, or the requirement to prove restores actually work.

## M1 acceptance impact

- `Production deploy pipeline runs migrations`: still required, using the production mapping above.
- `One backup restored successfully into a scratch project`: satisfied by an isolated disposable restore target; a persistent hosted restore project is no longer required.
- No M2 product scope is introduced by this revision.
