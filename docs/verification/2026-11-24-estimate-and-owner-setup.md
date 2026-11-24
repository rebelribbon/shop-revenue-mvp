# Mobile estimate, payment requirements and owner authorization setup

The payment-requirements link opened the old `/app/settings/payments` page.
Estimate pricing put the title, price and a wide reason selector in one flex
row, squeezing mobile descriptions into overlapping fragments. Sending was
blocked by a platform-policy approval process even though production contained
no authorization policy and no internal admin accounts.

## Prepared changes

- Account requirements opens `/automotive?view=payments` inside the current
  workspace. Old Automotive payment-setting URLs redirect there. Requirements
  come from the connected account, with readable labels and a Stripe link for
  provider-managed verification. Missing provider data is shown as unavailable.
- Estimate cards have separate description, total, parts/labor, internal cost
  and action rows. Mobile reason selectors and Remove buttons have 48px targets.
- Settings contains **Customer authorization**. The owner supplies terms and
  explicitly confirms their use, then selects **Enable document sending**.
  The send-screen blocker links to this setup and returns to its RO afterward.

Owner-enabled terms are distinct from platform/attorney-approved policies.
They are tenant-scoped, append-only versions with the owner's identity, timestamp
and body hash. Existing platform policies remain supported. Estimates freeze
the exact terms; customer decisions, drawn signature, hashes and archived PDF
remain required. A newer terms version invalidates unsigned proposals using
the older version, while signed historical evidence remains available. The
owner is told about the resend requirement before changing terms.

Migration 0058 adds this storage and extends the existing guarded capability
functions. It has been applied only to development (`gcclcuvdrqqllolxqhok`),
after reconciling development's unrecorded 0057. Production remains on 0057.
The current code must not be deployed before production's migration 0058.

## Verification

TypeScript and scoped ESLint pass. Nine recovery, payment-summary and UX tests
and seventeen release-gate tests pass. Added integration tests cover owner-only
activation, version history, tenant isolation and exact signed evidence; those
tests remain for the full database-backed CI suite.

A development PostgreSQL transaction exercised owner insertion, denial of a
different shop's owner, cross-shop reads, immutable terms, forged policy scope,
complete customer decisions, exact archived terms and version replacement.
Every assertion passed. The transaction rolled back all fixtures and temporary
role membership; the new terms table contains zero rows afterward. RLS is both
enabled and forced.

Browser checks rendered the actual adapter and stylesheet with fictional data.
At 340 CSS pixels, both example price cards have no title/price intersection,
selectors and Remove controls are 48px tall, and estimate/proposal/setup/payment
screens have no horizontal overflow. The setup checkbox starts unchecked. Both
Settings and the send blocker lead to authorization setup. Payment requirements
uses the current shell with no legacy header. Static-preview links were mapped
to its root because its directory redirect discards query parameters. This is
Chromium preview coverage, not authenticated production or real-device Safari QA.

The owner approved deployment on November 24. Next.js and eslint-config-next
are updated together to 16.4.5 with a consistent lockfile. The full production
build now passes using local public-auth placeholders. Publication and
production migration 0058 are in progress; the migration requires a fresh
production backup check first.
