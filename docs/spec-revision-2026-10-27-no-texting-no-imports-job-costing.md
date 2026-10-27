# Scope revision: omit automated texting and historical imports

Status: Adopted by the product owner, 2026-10-27.

For the design partner release, M5 automated texting and M6 concierge imports are out of scope. The shop contacts customers using its own channels. Shops enter customers, vehicles, recommendations and job history as they use the application.

M2 must be completed before the estimate and job workflow is accepted. M3 adds job costing: estimated billable labor hours and sell rate, actual labor hours and internal cost rate, part quantities and unit costs and selling prices, and estimated and actual gross profit. Unknown actual costs and time must remain unknown, not silently become zero. Gross profit excludes overhead, tax and processing fees unless explicitly included. Internal cost and margin must not appear in customer-facing estimates, invoices or public links. Preserve authorization versioning, tenant isolation and all existing M3 acceptance requirements.

M4 adds invoices and payments. M7 derives opportunities from data entered or generated within the product, including declined work and recorded service recommendations; missing historical data must never be invented. M8 keeps directly recovered and influenced revenue separate and uses evidence for attribution. M9 completes the release gates. No outreach is sent by Shop Revenue.

This revision does not change customer authorization requirements, existing release security requirements, or the scope of M1 acceptance.

