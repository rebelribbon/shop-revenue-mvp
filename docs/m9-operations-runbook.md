# Operations runbook

## Sign-in and recovery

Use the normal sign-in/reset routes. Never restore a temporary owner bootstrap page or publish a password. Check email-provider delivery and Supabase Auth SMTP separately. Reset errors intentionally do not reveal whether an account exists. Throttles expire automatically. After a password change other sessions are revoked. If an authenticator is lost, verify ownership through the approved support process before any account intervention; never remove verified factors on an unauthenticated request.

## Maintenance failure

Check `/api/health` for last successful maintenance time; more than 26 hours is unhealthy. Check scheduler response codes and function logs by request ID. A 401 means bearer authentication failed; a 503 means the endpoint is not configured. Inspect the private deployment configuration without exposing secrets. Retry an authenticated call to the exact preview/release endpoint. Do not retry payments or create financial events from this endpoint. A busy result means another invocation owns the lock; it is not a successful reconciliation heartbeat. Failed queue jobs retain retry state in Graphile. Confirm a new successful heartbeat after remediation.

## Payments and revenue

Verify the environment first (sandbox vs live), connected shop account, invoice and Stripe event ID. Use the existing idempotent webhook/worker path. Never edit paid totals, reuse checkout URLs or manufacture attribution to make a test pass. Owner-declared contact and exact authorized work/payment provenance are required for recovered revenue. Direct and influenced figures stay separate.

## Customer export and privacy

An owner can export records from Settings. NDJSON is paged at a fixed start cutoff and contains confidential customer data and internal costs. Changes during download can appear on a subsequent export; it is not an atomic backup. Staff/support cannot download owner exports. Do not attach exports, credentials or public bearer links to support tickets. Use request IDs and sanitized diagnostics.

## Incident and recovery

Keep an incident timeline with affected environment, exact deployment SHA, symptom, owner and decision. Contain access with existing support-session revocation and deployment controls. Do not disable RLS or deployment protection. For a bad app release, restore the last verified compatible build; do not automatically reverse migrations. For database loss/corruption, follow the existing backup/restore drill with an isolated target, verify grants/RLS/counts/journal and Auth/Storage recovery separately, document restore duration and obtain owner approval before cutover. Verify app/public/webhook smoke and payment idempotency before reopening. Off-site backup recovery is not proven by the disposable CI schema drill.

## Alert drill and release

Configure the actual monitoring destination and named on-call owner. Trigger a synthetic staging failure without customer data, observe arrival and acknowledgement, and record time/request ID. Verify recovery clears the alert. Before release run CI/E2E on the candidate SHA, independent security review, production configuration checks, SMTP delivery, backup restore/PITR and design-partner smoke checks. Supply actual dated references to the production dispatch gate. An empty evidence object blocks production before migrations.
