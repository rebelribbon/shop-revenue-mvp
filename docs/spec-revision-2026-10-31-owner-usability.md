# Owner usability revision — October 31, 2026

Requested after the founder supplied a phone-sized workflow review. Builds on authorization/tax PR #22; it does not relax policy approval, explicit line decisions, frozen estimates, signed work limits, payment confirmation, tenant isolation or launch gates.

## Everyday use

Jobs and Visits are the consistent shop-facing names. Owners have Home, Customers, Jobs, Visits and Money in the main navigation; Settings is a header utility. At 320px, Home moves to the labelled shop-name link so the other four destinations keep readable 16px labels and 48px targets with 8px gaps. Staff keep their existing operational access and cannot open the owner Money screen or write expenses/templates.

A job leads with one status sentence and next action. Approved/declined work, payment details, costs, changes and history remain available in disclosures. Waiting jobs check for a reply when the owner returns to the app and every 30 seconds while visible. Opening an invoice still does not complete work or record payment.

Tax defaults from PR #22 remain in place. Owners can set customer and internal hourly labor rates. New labor uses those defaults; existing lines keep their values. A job can be saved as a common job and reused, with a database-enforced cap of 25 active entries per shop. Templates contain no customer, vehicle or recovery links. Quantity/internal costs/actual hours/tax flags remain editable under line details. Transient invalid numeric edits show validation instead of throwing during the live cost preview. Payment forms start with the outstanding balance.

Visits show a navigable Monday–Sunday week with a date picker. Searchable customer choices show 50 matches at a time, preserve a selected record outside that slice, and let the owner add a customer without losing the visit/job draft. Vehicle/equipment choices are filtered to the selected customer. Booking a future visit opens that week.

## Money and expenses

The owner Money screen uses database totals rather than the most recent 100 UI records:

- Collected: net payment ledger entries recorded during the selected shop-local month, including tax and negative corrections/refunds.
- Owed: the positive outstanding balance of every non-void invoice, across all dates. An open checkout is not a payment.
- Expenses: net logged outflows by date paid. Corrections exactly reverse the original entry on its original date; neither row is deleted. This is a bookkeeping correction, not a vendor refund or bank movement.
- Cash left: collected minus logged expenses. This is cash movement, not accounting profit or money available after tax.
- Estimated profit: active invoices issued in the selected month, before sales tax, minus costs from the job sheet at the time of the estimate and minus logged expenses not already included in those job costs. Labor uses quoted hours. Missing original costs produce an unavailable estimate rather than zero assumed costs. Unpaid invoices are included; this is a quote-based estimate, not an accounting profit-and-loss statement. Processor fees, income tax, unrecorded expenses and cash-only refund effects on invoice sales are not inferred.

Rent, tools, supplies, utilities, insurance, marketing, parts, labor and other expenses are supported. Entries can be marked as already included on a job, preventing a second profit deduction while retaining their cash effect. The expense ledger is append-only, owner-written, audited, included in owner exports and protected by tenant RLS and composite references. Active common jobs are also exported.

## Owner-controlled sharing

Text/Email opens the owner's own compose app with the customer link. The owner chooses Send. The app does not send SMS/email through a provider, assert delivery, mark approval or record payment. A native OS share-sheet option and copy fallback cover browser/device variations. Real iPhone/Android compose-app testing remains required: URI construction in Chromium does not prove native recipient/body behavior. References: [RFC 5724](https://www.rfc-editor.org/rfc/rfc5724.html), [Apple SMS URL scheme](https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/SMSLinks/SMSLinks.html), [Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API).

A server-only AES-256-GCM cache preserves the existing bearer token so resending does not invalidate a customer's earlier link. The cache key is domain-separated from the existing high-entropy session signing secret. Cached values are excluded from public resolvers and owner exports; hash verification, tenant access, expiration, revocation, policy and support guards still apply. Key rotation or older documents without a cache require explicit link replacement. Unsigned documents with missing/retired approval policies must be revised before sharing. No plaintext token is written into a cache, activity record or idempotency response. Owner confirmation of sending remains separate from a delivery receipt.

## Verification and launch

Run the full real-Postgres/RLS/restore suite, phone/desktop browser suite, and the owner usability scenario against a development server so React form/hydration errors cannot hide behind a production build. The local-only large-list fixture creates 500 synthetic customers in shop B when explicitly enabled for E2E. Test native compose apps and watch a real shop owner use the app unaided before first-shop approval. Counsel-approved policy configuration, CPA confirmation, independent candidate review, branch protection and the existing operational launch evidence remain required. This revision does not authorize production release.
