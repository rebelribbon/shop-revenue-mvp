# Scope revision: business-type workspaces

Founder approval: October 29, 2026 (America/Chicago; October 30 UTC). Recorded October 31, 2026 after the independent review identified the missing dated revision.

The founder explicitly requested support beyond automotive for home improvement, HVAC, plumbing and handyman work, first as a separate branch and then as one product configured by business type. PR #12 implemented Automotive, HVAC, Plumbing, Home Improvement, Handyman and Other Home Services. This intentionally supersedes the frozen v1.1 exclusion of other trades for the shared customer/workflow model.

Vehicles remain the automotive target. Properties and equipment are service targets for home-service workspaces. Both use the same customers, costing, frozen estimates, authorization, invoicing, payment ledger and tenant boundaries. Switching business type preserves historical record targets. PR #20 corrected automotive wording and workspace cache invalidation.

This authorization does not certify trade-specific contracts, taxes or regulations. The security review must include both target paths, asset/customer foreign keys, business-type switching and support access. Tax defaults must be reviewed for each business; automotive assumptions must not be represented as universal rules for other trades. Additional specialist vertical modules remain outside this revision.
