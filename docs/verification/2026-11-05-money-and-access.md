# Money and technician access corrections — 2026-11-05

Money's cash ledger uses the date each payment or refund arrived. The invoice
profit estimate uses the invoice's issue month and only its approved lines,
with the internal costs recorded when its estimate was frozen. These are
separate measurements. Money links later collections back to the issue month
and carries missing-cost warnings into the payment month. A month with no
invoices or counter sales does not present a zero profit result.

The Profit by job report now uses exactly the same invoice-cost calculation
as Money. It no longer allocates costs in proportion to selling prices. Money
also subtracts the counter sale's stored item costs, and suppresses its profit
estimate if any counter sale has missing costs. Tax, net receipts, reversals,
expenses and the payment ledger retain their existing date and sign rules.

The job-sheet profit panel remains a different, explicitly labeled operational
estimate: the current whole job sheet, recorded time when available, and estimated
card fees. It can include unbilled work. It is not recognized sales or the
invoice-month profit report. Neither estimate is a tax return or a complete
accounting profit statement.

An estimate without a job.costed record is visible in Jobs as a document-backed
entry. It opens its existing customer documents, authorizations and payment
history. Its original internal costs remain unknown. This read model does not
create cost history, backfill zero costs, alter signed estimates, or change
invoice dates. Estimate editing/publishing is disabled for these entries.

Technician domain job reads always scope to the current user's assignments,
even when the caller omits a filter or supplies another user's ID. Technicians
cannot create unassigned jobs or change assignments. Server actions deny
technicians by default; explicitly permitted work checks the assigned job,
customer and/or upload ownership inside the transaction. Assignment access is
checked before returning an idempotent replay as well. A technician can stop
their own running clock after reassignment.

Home's setup link names the missing business type, phone or address rather
than implying that the shop has not begun work.

Regression coverage exercises later-month receipts and missing-cost context,
legacy jobs and tenant isolation, approved-line costs, counter costs and voids,
implicit technician scoping, direct actions and revoked-assignment replays.
Browser coverage includes Money's date explanation and technician controls,
with the existing phone/desktop UX checks preserved.

These changes require no schema migration and no changes to shared shop data.
Production deployment, branch protection and offsite backup configuration are
separate release work; these source changes do not complete those gates.
