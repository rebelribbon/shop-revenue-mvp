# M8 recovered revenue — manual-v1

This implements recovered-revenue attribution for the adopted manual-contact product. Shop Revenue sends no outreach and claims no unobserved link clicks, delivery receipts, replies, imports or historical revenue.

## Evidence and credit

- Every logged contact remains an immutable customer activity. A shop user can explicitly confirm that the customer was reached or the message was delivered; unchecked/legacy contacts are not assumed delivered.
- Recording a response attaches it to the latest actual contact. The actor's owner/staff role is resolved on the server. Only an owner-confirmed response qualifies for direct credit. Earlier M7 notes are not retroactively upgraded into proof.
- New work retains both opportunity and exact contact identity. Appointments can create jobs while preserving their source. Frozen estimates retain contact/appointment identity; each re-quoted part/labor line can link to an actual recommendation. Those links are internal and immutable, and never enter customer-facing snapshots.
- Direct declined work counts only billed lines traced to recommendations recorded at contact time. Other work on the visit is shown separately as not counted. Direct open-estimate and unpaid-invoice rules require the exact subject document. Lapsed/service-due visits require a linked work chain.
- Versioned timing constants: response within 30 days of contact; linked work within 30 days of the response; succeeded/recorded payment within 60 days of the response; unpaid-invoice collection within 14 days of the response. Confirmed delivery without a qualifying direct chain can influence the first eligible invoice first issued within 45 days. Each invoice has one attribution; direct beats influenced; direct last-touch and latest eligible delivered-contact rules resolve conflicts. A contact can influence only one invoice.
- Amounts use actual counted invoice lines before tax, multiplied by eligible net recorded payments divided by invoice total, with integer half-up rounding. Partial payments are prorated. Original opportunity prices are never credited as revenue. Negative entries reduce only the payment they reverse/refund, including refunds after the eligibility window. Pending/failed provider states have no ledger payment and earn no credit.
- Invoice disputes recorded by the shop pause credit; resolving the hold re-evaluates it. Voids and manual payment reversals re-evaluate automatically. This does not synchronize Stripe chargebacks/disputes; reported disputes must be recorded using the existing invoice dispute control.

## Ledger and reporting

The tenant-scoped attribution header is unique per invoice. A database constraint caps influenced allocation per contact. Every changed calculation appends an immutable event, preserves the previous decision, records separate direct/influenced deltas, and writes an audit event. Evidence stores contact/response, quote/version/authorization/appointment, invoice, line and payment references plus exact calculation inputs and rule version. Identical evidence does not create another event.

The Money home and Revenue screen show directly recovered and influenced amounts separately. Monthly figures are net ledger adjustments posted in the shop's timezone, so later refunds/corrections can reduce a month’s figure. Attribution records retain all dates, detailed explanations, evidence, and revision history. There is no combined total.

Owner-only “Not from this follow-up” reverses credit with a reason without changing the invoice or moving money. It stays excluded across automatic evaluations until the owner restores evaluation with another reason. Staff can view results and refresh deterministic evidence; support is read-only. There is no arbitrary positive-credit override in the shop UI.

## Execution and operations

Manual payments/reversals, verified Stripe settlement/refunds, invoice voids/dispute changes and new responses call evaluation inside the same transaction. Tenant-level advisory locking precedes invoice money row locks. Normal payment evaluations scope source records to the affected customer. The explicit Refresh action reconciles recorded tenant evidence without contacting payment providers or moving money.

A tenant-scoped `reconcile_revenue` worker task and deduplicated nightly queue entries provide the 120-day payment recheck backstop when the repository's worker runtime is enabled. The currently deployed preview deliberately has no always-on worker. Synchronous financial-event evaluation operates independently; activating and monitoring the nightly hosted worker remains a launch operations gate, alongside the existing M9 email/security/provider-fault gates. No production configuration changes are part of M8 preview deployment.

Verification evidence will be recorded below after database/browser/deployment checks finish.
