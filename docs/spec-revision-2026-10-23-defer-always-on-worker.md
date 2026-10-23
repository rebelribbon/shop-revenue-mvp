# Spec Revision — Defer Paid Always-On Worker Runtime

Date: 2026-10-23
Status: Adopted for M1 hosted design-partner environment

## Decision

The hosted M1 environment will not provision a separate paid always-on worker service.

The original architecture includes one long-running Graphile Worker process. The current design-partner M1 does not yet contain provider-specific webhook handlers or other customer-facing workflows that require continuous asynchronous execution. Requiring a third paid runtime at this stage adds recurring infrastructure cost without delivering M1 product value.

## M1 hosted behavior

- Vercel hosts the Next.js web application.
- Supabase hosts Postgres, Auth, and Storage.
- The Graphile Worker schema and queue remain provisioned in Postgres so later milestones can activate asynchronous processing without a data-model rewrite.
- The standalone worker process remains available in the repository for local testing and future hosted activation.
- Provider webhook events are still signature-verified, durably stored first, deduplicated, visible in the internal admin inbox, and replayable.
- Provider-specific asynchronous handlers remain deferred until the milestone that introduces those provider behaviors.
- The production `/api/health` endpoint reports the health of the currently required deployed runtime: web service plus database. Absence of a deliberately unprovisioned worker is not a web-service outage.

## Cost rationale

The design-partner MVP should not require an additional always-on compute subscription before a feature actually depends on it. The worker may be activated later on an appropriate runtime or replaced by a serverless/event-driven execution model when background processing becomes product-critical.

## Security and data integrity

This revision does not weaken tenant RLS, role separation, webhook signature verification, durable webhook storage, idempotency, audit logging, or database ownership boundaries. Runtime roles and Graphile Worker database objects remain in place.

## Acceptance impact

For hosted M1 acceptance, successful production health means the deployed web runtime can connect to the production database and return HTTP 200. A continuous worker heartbeat is no longer required for hosted M1 acceptance.

The worker-specific acceptance item is deferred to the first milestone that requires continuous asynchronous processing. No change is made to the frozen customer-facing MVP scope.
