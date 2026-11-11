# Mandatory two-factor authentication — November 5, 2026

Brad requested two-factor authentication to protect customer information. All
hosted shop logins (owner, staff and technician) and internal admin/support logins
must complete authenticator enrollment and verification before opening records.
The app checks the session's Supabase AAL2 assurance on pages, actions and direct
downloads. Standalone shop payment and VIN actions also require MFA. Reports,
signed PDFs and shop media now enforce the same requirement
as the existing owner export route. Customer bearer links retain their existing
document-specific scope and tenant isolation.

An environment flag cannot turn MFA off on hosted Auth. Local/test environments
using local Auth can bypass MFA for the ordinary fixture suite; `REQUIRE_MFA=true`
forces the full flow for a dedicated local-stack browser run. The legacy
`REQUIRE_OWNER_MFA=true` flag also forces verification for every role. Missing or
unavailable assurance fails closed. No database permissions or schemas change.

The dedicated browser scenario signs in as each of the five roles, confirms
that records/direct downloads are blocked, enrolls a real local TOTP factor,
verifies its code, then confirms that a fresh login is challenged again. Screenshots
are captured only after enrollment secrets have been removed. Server regressions
also check direct downloads before any customer-data query is made.

Production was still serving m1-foundation commit
`49b625acab865f935331387409d983df0ca5ef1d` when checked on November 5. Public signup
was disabled. A read-only aggregate found no verified MFA factors on the sole
production Auth account. No real account's MFA enrollment was changed. Enabling
TOTP and testing enrollment on the owner's own device remains a production
release requirement, alongside deployment/configuration gates. Supabase also
reported leaked-password protection disabled; it must be enabled in hosted Auth
settings and verified before launch. This revision does not assert that MFA is
already active on the public site or that an independent security review passed.
