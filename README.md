# shop-revenue-mvp

Design Partner MVP. The frozen build spec is [`docs/build-spec-v1.1.pdf`](docs/build-spec-v1.1.pdf) (v1.1, October 22, 2026). Milestone 1 status, test evidence, spec issues and the setup steps for not-yet-created accounts are in [`docs/m1-report.md`](docs/m1-report.md).

Stack (spec D1/D2): one Next.js App Router app (TypeScript), one Graphile Worker process, one PostgreSQL database (Supabase, used as plain Postgres through Drizzle). The browser never queries the database.

## Local development

Requires Docker, Node 24, pnpm (version pinned in `package.json`), and the Supabase CLI 2.121+.

```sh
pnpm install
printf 'SUPABASE_AUTH_HOOK_SECRET="v1,whsec_%s"\nSUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN="placeholder-not-used-hook-delivers-sms"\n' "$(openssl rand -base64 32)" > supabase/.env
pnpm stack:up        # Supabase local stack: Postgres, Auth, Storage, Mailpit (fixes the codespace bridge firewall)
pnpm env:local       # writes untracked .env.local; role passwords generated once, never printed
pnpm db:bootstrap    # roles: migration_owner, app_user, worker_user, admin_user
pnpm db:migrate      # Graphile schema + migration chain, as migration_owner
pnpm db:check-rls    # CI rule: every business_id table has RLS enabled, forced and a policy
pnpm seed            # tenants A and B (owner + staff), two admins, one support user
pnpm dev             # http://localhost:3000
pnpm worker          # in another terminal
```

Signing in locally:

| Who | How |
| --- | --- |
| Owners | `owner.a@shop-a.test`, `owner.b@shop-b.test`: email link, read it in Mailpit at http://127.0.0.1:54324 |
| Staff | `(512) 555-0101` (A), `(512) 555-0202` (B): SMS code, read it at http://localhost:3000/dev/inbox |
| Admin console | `admin.one@example.test`, `admin.two@example.test` (admin), `support.one@example.test` (support) at `/admin/sign-in` |

Sign-up is closed: people get access only through invites (`createBusiness` for owners, Team settings for staff).

## Tests

```sh
pnpm test            # Vitest against a fresh database per run, with production roles, RLS and triggers
pnpm e2e             # Playwright at 390x844 and desktop (needs the stack, seed and `pnpm dev`)
pnpm lint && pnpm typecheck
pnpm backup:restore-drill   # dump -> scratch DB -> verify (SOURCE_ENV / TARGET_ENV)
```

CI (`.github/workflows/ci.yml`) applies the full migration chain to an empty Postgres 17, runs the RLS presence check and a self-test proving it rejects a tenant table without RLS, then lint, typecheck and the suites. `e2e.yml` runs Playwright against the Supabase CLI stack on the runner.

## Rules that keep tenants apart

- Tenant data is only touched inside `withTenant()` (`src/db/tenant.ts`): one transaction, `set_config(..., is_local)` for business and actor, so pooled connections never carry context. Outside it, RLS returns nothing.
- Only `src/db/tenant.ts` and `src/db/admin.ts` may import `pg` or `drizzle-orm/node-postgres` (ESLint rule).
- New tenant tables call `SELECT app.apply_tenant_rls('app.<table>')` in their migration and get a builder in `tests/db/rls.test.ts`; CI fails otherwise.
- Never `source` the `.env*` files in a shell: connection URLs contain `&`. Use `ENV_FILE=... pnpm <script>`.
