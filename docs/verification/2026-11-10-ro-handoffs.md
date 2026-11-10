# Assigned RO handoffs

The authenticated app routes inspection work to an active technician account and
the completed assessment to the RO's assigned advisor. Handoffs use the tenant
activity ledger and survive page reloads and sign-ins on another device.

- Assignment changes and inspection submission serialize on the RO's transaction
  lock. Changing the advisor reroutes their pending Build Estimate task. Saving
  the same assignment again creates no duplicate. Changing technicians does not
  reopen an already submitted inspection.
- Technicians have only assigned ROs and Tasks in both navigation variants.
  Deep links and server actions enforce the restriction. Technicians cannot
  create or price job sheets, import estimate lines, invoice or collect payment.
- Inspection progress includes pickup confirmation, bay/work area and diagnosis.
  Submission requires this assessment, every checkpoint, and the findings and
  proposed work required by Service Soon / Service Now. The server checks the
  checkpoint set and owns labels and estimate-import markers. Partial drafts do
  not notify the advisor. Submitted results are preserved in an immutable
  activity snapshot and cannot be overwritten through the save endpoint.
- Advisors review the saved diagnosis and inspection. Recommended work can be
  imported once into the draft estimate without retyping. Import bookkeeping
  preserves the original submitted snapshot. Published estimates complete the
  advisor handoff.
- The header refreshes only the account-specific handoff inbox every 30 seconds
  while visible and when returning to the app. It does not refresh the form or
  discard unsaved fields. The endpoint requires a shop session and MFA, disables
  caching, and returns only task IDs, RO IDs and task titles. No external push,
  email or SMS notification is represented by this feature.

Verification includes real-Postgres tests for assignment ownership, recipient
routing, draft/submission separation, frozen inspections, checkpoint tampering,
and direct technician pricing denial. Browser coverage signs in as an owner,
technician and assigned advisor to follow the handoff on desktop and phone,
verify diagnosis persistence, and check restricted navigation and deep links.
The desktop sample preview remains a separate simulation. Its current action
stays in the form so it cannot obscure the bottom-left view switch.

No schema migration is required. These changes are on PR #83; a preview build
does not promote the production application or certify the separate document,
payment, QC and physical-delivery flows.
