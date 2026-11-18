# Shop Revenue — Automotive Repair (approved standalone design)

**Decision:** Approved by the product owner on 2026-11-18.

**Canonical standalone prototype:** [`public/automotive/index.html`](../../public/automotive/index.html)  
**Serve as a standalone static file:** `/automotive/index.html` on a preview environment that includes this branch.  
**Baseline SHA-256:** `7c62daf9d2d5e1032ed2ce8b10bea711f786877a253b34ca9ab2189b15108a8e` (exact source HTML).

This is the **accepted UX and workflow reference for Automotive Repair**. Preserve it as an independent vertical, separate from Home Services. No automotive screens should mix HVAC, property, room or home-improvement fields. Common infrastructure (shop users, billing, identity, audit, notifications) may be shared, but each vertical has its own workflows, vocabulary and presentation.

## Accepted screen model

- Overview with work needing attention.
- Appointments and workflow-generated confirmations and check-in tasks.
- Tasks generated from actual workflow states, **not manual completion as a substitute for the underlying operation**. Each task belongs to exactly one assignee, is private to that employee, and is visible to authorized managers/owners. A reassignment transfers relevant open work and revokes prior access.
- Customers → customer detail → vehicle detail → **every RO for that vehicle**, including open and closed records; open an RO or create a new one prefilled with the correct customer and vehicle.
- RO workspaces: check-in, technician inspection, advisor pricing, review and send, customer authorization, authorized repairs, invoice, payment, receipt, documents and history. The current stage and next actor/action should remain obvious with minimal scrolling.
- Customer-facing estimate link: repair-by-repair approve/decline, prices and totals, inspection documents, estimate, terms, signatures/acknowledgment, and invoice/receipt when applicable. The advisor sees the returned decisions and automatically assigned next action.
- Reports and team settings, including owner dual-role view and employee permissions.
- Responsive desktop/mobile; compact actions beside customer name rather than a separate large quick-actions card.

## Canonical workflow

Check in → Assign technician → Inspect / diagnose → Advisor prices work → Review packet → Send customer link → Record individual approvals/declines and signature → Perform **authorized** work → Advisor issues invoice → Confirm actual payment → Issue receipt / release vehicle → Close RO.

A transition must complete the originating action, create or update the next assigned task, and retain a durable audit/history event. Never show another advisor's or technician's assigned tasks.

## Product split

- **Automotive Repair:** The screens and flow in the approved standalone baseline are the source of truth for UX changes.
- **Home Services:** Separate vertical and workflow, unchanged by this approval. Do not present property/room/HVAC fields inside Automotive Repair.
- User selection of business type should determine their vertical at onboarding and in the app; shared entities remain tenant-isolated.

## What is NOT production-ready in this artifact

The HTML is a **local interactive simulation**, not a new authenticated or hardened CRM service. It persists simulated records in browser localStorage. Customer links, signatures, external delivery, invoices, receipts, tasks, employee visibility and payments are demo behavior. The sample role switcher is **not** an authorization boundary.

Before adopting the visual UX into the actual Next.js/Postgres app, connect it to real tenant-scoped tables and server actions; enforce manager/owner and per-assignee visibility in RLS and APIs; use immutable estimate/authorization versions and durable signed records; implement documents/attachments and email delivery; make Stripe Connect funds flow to each shop; audit events and workflow transitions with idempotency; then run the full device and browser end-to-end suite.

**Release rule:** Keep the approved standalone file unchanged except for explicit owner-approved design revisions. Implement the production Automotive vertical incrementally behind tests. Do not publish this prototype to a production app origin or advertise simulated authorization/payments as live functionality.
